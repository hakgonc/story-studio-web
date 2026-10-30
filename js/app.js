// Story Studio 웹: GitHub 저장소의 스토리 데이터(story-data/1)를 브라우저에서 고치고 커밋한다.
// PC 판(StoryStudio.exe)에서는 같은 화면이 PC 폴더를 직접 읽고 쓰고 git 을 부른다 (local.js)
import { GitHub, GitHubError, gitBlobSha } from "./github.js";
import { StoryProject, isStoryPath, PROFILE_PATH, arr, obj } from "./project.js";
import { StoryValidator, issueText, OBJECTIVE_TYPES } from "./validator.js";
import { loadSettings, saveSettings, repoKey, loadRepoCache, saveRepoCache } from "./store.js";
import { markdownToHtml } from "./markdown.js";
import { h, clear, toast, confirmBox, promptBox, fieldForm } from "./ui.js";
import { renderDialogue } from "./dialogue_view.js";
import { loadHelp, renderHelp } from "./help.js";
import { DESKTOP, local, localRepo, LocalError } from "./local.js";

export const VERSION = "0.4.0";

const TABS = [
	{ id: "docs", label: "문서", icon: "📖" },
	{ id: "flow", label: "장·미션", icon: "🗺" },
	{ id: "dialogue", label: "대사", icon: "💬" },
	{ id: "cast", label: "인물", icon: "👤" },
	{ id: "check", label: "점검", icon: "✔" },
	{ id: "commit", label: DESKTOP ? "저장·Git" : "커밋", icon: "⬆" },
	{ id: "settings", label: "설정", icon: "⚙" },
];

export const state = {
	settings: loadSettings(),
	repo: null,          // { owner, name, branch }
	head: null,          // { sha, tree, message, date }
	meta: {},            // path → blob sha (head 기준)
	project: null,
	tab: "flow",
	sel: {},             // 탭별 선택 { flow: {...}, dialogue: id, docs: path, cast: id }
	detail: false,       // 좁은 화면: 상세를 보고 있음
	busy: false,
	offline: false,
	conflicts: [],       // 초안을 원격 변경 위에 얹지 못한 파일
	help: null,          // 도움말을 보고 있으면 절 id (docs/HELP.md 의 {#id})
};

const $view = () => document.getElementById("view");

// ── 시작 ─────────────────────────────────────────────

export async function start() {
	renderShell();
	const s = state.settings;
	const cur = s.repos.find((r) => repoKey(r) === s.current) || s.repos[0];
	document.addEventListener("keydown", onKey);
	if (!s.token && !DESKTOP) {
		state.tab = "settings";
		render();
		return;
	}
	if (cur) await openRepo(cur);
	else {
		state.tab = "settings";
		render();
	}
}

// F1 도움말, PC 판 Ctrl+S 저장
function onKey(e) {
	if (e.key === "F1") {
		e.preventDefault();
		openHelp();
	} else if (DESKTOP && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
		e.preventDefault();
		saveToDisk();
	}
}

export function repoLabel(r) {
	return r.path ? r.name : `${r.name} (${r.branch})`;
}

// 저장소 읽기: 웹은 GitHub API, PC 판은 PC 폴더
function source(repo) {
	if (DESKTOP) {
		return {
			head: () => local.head(repo.path),
			tree: () => local.tree(repo.path),
			read: (path) => local.read(repo.path, path),
		};
	}
	const gh = new GitHub(state.settings.token);
	return {
		head: () => gh.headCommit(repo.owner, repo.name, repo.branch),
		tree: (head) => gh.tree(repo.owner, repo.name, head.tree),
		read: (path, sha) => gh.blobText(repo.owner, repo.name, sha),
	};
}

function renderShell() {
	const app = document.getElementById("app");
	clear(app);
	app.append(
		h("header", { class: "top" },
			h("div", { class: "brand" }, "Story Studio"),
			h("select", { id: "repo-select", class: "input repo", onchange: (e) => onRepoSelect(e.target.value) }),
			h("span", { id: "status", class: "status" }),
			h("button", { class: "btn small", id: "reload", title: DESKTOP ? "디스크에서 다시 읽기" : "GitHub 에서 다시 받기", onclick: () => state.repo && openRepo(state.repo, true) }, "⟳"),
			h("button", { class: "btn small", id: "help", title: "도움말 — 지금 탭의 사용법", onclick: () => openHelp() }, "?")),
		h("nav", { id: "tabs", class: "tabs" },
			TABS.map((t) => h("button", { class: "tab", "data-tab": t.id, onclick: () => setTab(t.id) }, h("span", { class: "ico" }, t.icon), h("span", { class: "lbl" }, t.label)))),
		h("main", { id: "view", class: "view" }),
		h("div", { id: "toast", class: "toast" }));
	fillRepoSelect();
}

function fillRepoSelect() {
	const sel = document.getElementById("repo-select");
	clear(sel);
	for (const r of state.settings.repos) {
		const k = repoKey(r);
		sel.append(h("option", { value: k, selected: state.repo && repoKey(state.repo) === k }, repoLabel(r)));
	}
}

async function onRepoSelect(key) {
	const r = state.settings.repos.find((x) => repoKey(x) === key);
	if (r) await openRepo(r);
}

export function setTab(id) {
	state.tab = id;
	state.help = null;
	if (DESKTOP && id === "commit") gitInfo = null; // 탭을 열 때마다 git 상태를 다시 읽음
	state.detail = false;
	render();
	window.scrollTo(0, 0);
}

function updateStatus() {
	const el = document.getElementById("status");
	if (!el) return;
	const p = state.project;
	const n = p ? Object.keys(p.changes()).length : 0;
	el.textContent = state.busy ? "불러오는 중…" : p ? `${state.offline ? "오프라인 · " : ""}${n ? `${DESKTOP ? "저장 안 함" : "변경"} ${n}` : DESKTOP ? "저장됨" : "변경 없음"}` : "";
	el.className = "status" + (n ? " dirty" : "");
	document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
	const commitTab = document.querySelector('.tab[data-tab="commit"] .lbl');
	const cl = DESKTOP ? "저장·Git" : "커밋";
	if (commitTab) commitTab.textContent = n ? `${cl} ${n}` : cl;
}

// ── 불러오기 ─────────────────────────────────────────

export async function openRepo(repo, forceRemote = false) {
	if (state.project && state.repo && repoKey(state.repo) !== repoKey(repo)) await saveDrafts();
	state.repo = repo;
	state.settings.current = repoKey(repo);
	saveSettings(state.settings);
	fillRepoSelect();
	state.busy = true;
	state.sel = {};
	state.detail = false;
	state.conflicts = [];
	gitInfo = null;
	updateStatus();
	clear($view()).append(h("div", { class: "empty" }, `${repo.path || repo.owner + "/" + repo.name} 불러오는 중…`));
	const key = repoKey(repo);
	const cache = await loadRepoCache(key);
	try {
		const src = source(repo);
		const head = await src.head();
		let files = {}, meta = {}, allPaths = null;
		if (cache && cache.head && cache.head.sha === head.sha && !forceRemote) {
			for (const [p, f] of Object.entries(cache.files)) {
				files[p] = f.text;
				meta[p] = f.sha;
			}
			allPaths = cache.allPaths || null;
		} else {
			const t = await src.tree(head);
			allPaths = t.truncated ? null : t.entries.map((e) => e.path);
			const shaOf = Object.fromEntries(t.entries.map((e) => [e.path, e.sha]));
			const old = cache ? cache.files : {};
			const want = t.entries.filter((e) => isStoryPath(e.path)).map((e) => e.path);
			await fetchBlobs(src, want, shaOf, old, files, meta);
			// 문서 목록은 project.json 에 있음
			let docs = [];
			try {
				docs = arr(JSON.parse(files[PROFILE_PATH] || "{}").docs).map(String);
			} catch (_) {
				docs = [];
			}
			await fetchBlobs(src, docs.filter((d) => shaOf[d]), shaOf, old, files, meta);
		}
		state.head = head;
		state.meta = meta;
		state.offline = false;
		const project = new StoryProject(files, allPaths);
		applyDrafts(project, cache, meta);
		state.project = project;
		await saveRepoCache(key, {
			head, allPaths, savedAt: Date.now(),
			files: Object.fromEntries(Object.keys(files).map((p) => [p, { sha: meta[p], text: files[p] }])),
			drafts: cache ? cache.drafts || {} : {}, draftBase: cache ? cache.draftBase || {} : {},
		});
		if (project.loadErrors.length && !files[PROFILE_PATH]) toast("이 저장소에는 data/story/project.json 이 없음 — story-data/1 로 전환된 게임 저장소를 고르세요", true);
	} catch (e) {
		if (cache && cache.files) {
			const files = Object.fromEntries(Object.entries(cache.files).map(([p, f]) => [p, f.text]));
			state.head = cache.head;
			state.meta = Object.fromEntries(Object.entries(cache.files).map(([p, f]) => [p, f.sha]));
			state.project = new StoryProject(files, cache.allPaths || null);
			applyDrafts(state.project, cache, state.meta);
			state.offline = true;
			toast((DESKTOP ? "폴더를 읽지 못함" : "GitHub 에 연결 못 함") + " — 이 기기에 저장된 데이터로 엽니다 (" + e.message + ")", true);
		} else {
			state.project = null;
			state.busy = false;
			toast(e.message, true);
			state.tab = "settings";
			render();
			return;
		}
	}
	state.busy = false;
	if (state.tab === "settings") state.tab = "flow";
	render();
}

async function fetchBlobs(src, paths, shaOf, old, files, meta) {
	const queue = paths.slice();
	const worker = async () => {
		while (queue.length) {
			const p = queue.shift();
			const sha = shaOf[p];
			if (old[p] && old[p].sha === sha) files[p] = old[p].text;
			else files[p] = await src.read(p, sha);
			meta[p] = sha;
		}
	};
	await Promise.all(Array.from({ length: 6 }, worker));
}

// 초안: 그 파일이 초안을 만들 때와 원격에서 그대로면 얹고, 바뀌었으면 충돌로 남김
function applyDrafts(project, cache, meta) {
	if (!cache || !cache.drafts) return;
	const base = cache.draftBase || {};
	for (const [path, text] of Object.entries(cache.drafts)) {
		if ((base[path] || null) !== (meta[path] || null)) {
			state.conflicts.push({ path, text });
			continue;
		}
		const err = project.applyText(path, text);
		if (err) toast("초안 적용 실패: " + err, true);
	}
	if (state.conflicts.length) toast(DESKTOP ? `디스크에서 바뀐 파일 ${state.conflicts.length}개에 저장 안 한 변경이 있음 — 「저장·Git」 탭에서 고르세요` : `원격에서 바뀐 파일 ${state.conflicts.length}개에 이 기기 초안이 있음 — 「커밋」 탭에서 고르세요`, true);
}

let draftTimer = 0;
export function changed() {
	updateStatus();
	clearTimeout(draftTimer);
	draftTimer = setTimeout(saveDrafts, 700);
}

async function saveDrafts() {
	if (!state.project || !state.repo) return;
	const key = repoKey(state.repo);
	const cache = (await loadRepoCache(key)) || { files: {}, head: state.head };
	const drafts = state.project.changes();
	for (const c of state.conflicts) drafts[c.path] = c.text;
	const draftBase = {};
	for (const p of Object.keys(drafts)) draftBase[p] = state.meta[p] || null;
	cache.drafts = drafts;
	cache.draftBase = draftBase;
	await saveRepoCache(key, cache);
}

// ── 화면 ─────────────────────────────────────────────

// 지금 탭의 도움말. 저장소를 아직 안 열었으면 「처음 시작」
export function openHelp(id) {
	const tabHelp = DESKTOP ? ({ commit: "pc-git", settings: "pc-settings" })[state.tab] || state.tab : state.tab;
	state.help = id || (!state.project && state.tab !== "settings" ? "start" : tabHelp);
	render();
	window.scrollTo(0, 0);
}

export function render() {
	updateStatus();
	const v = clear($view());
	v.className = "view tab-" + (state.help ? "help" : state.tab);
	if (state.help) {
		document.querySelectorAll(".tab").forEach((b) => b.classList.remove("on"));
		loadHelp().then((list) => {
			if (!state.help) return;
			clear(v);
			// PC 판은 「(웹)」 절, 웹은 「(PC)」 절을 빼고 보여 줌
			const mine = list.filter((x) => !x.title.includes(DESKTOP ? "(웹)" : "(PC)"));
			renderHelp(v, mine, state.help, (id) => openHelp(id), () => { state.help = null; render(); });
		}).catch((e) => { v.append(h("div", { class: "empty" }, e.message)); });
		return;
	}
	if (state.tab === "settings") return renderSettings(v);
	if (!state.project) {
		v.append(h("div", { class: "empty" }, state.busy ? "불러오는 중…" : "위에서 게임 저장소를 고르거나 「설정」에서 토큰과 저장소를 넣으세요."));
		return;
	}
	({ docs: renderDocs, flow: renderFlow, dialogue: renderDialogueTab, cast: renderCast, check: renderCheck, commit: renderCommit })[state.tab](v);
}

// 목록 + 상세 두 칸. 좁은 화면에서는 하나씩 (state.detail)
function split(v, list, detail, detailTitle) {
	const back = h("button", { class: "btn small back", onclick: () => { state.detail = false; render(); } }, "← 목록");
	v.append(h("div", { class: "split" + (state.detail ? " show-detail" : "") },
		h("section", { class: "pane list" }, list),
		h("section", { class: "pane detail" }, h("div", { class: "detail-head" }, back, h("span", { class: "detail-title" }, detailTitle || "")), detail)));
}

function openDetail(tab, sel) {
	state.sel[tab] = sel;
	state.detail = true;
	render();
	window.scrollTo(0, 0);
}

// ── 문서 ──
function renderDocs(v) {
	const p = state.project;
	const paths = p.docPaths();
	const cur = state.sel.docs || paths[0];
	const list = h("div", { class: "items" },
		paths.map((d) => h("button", { class: "item" + (d === cur ? " on" : ""), onclick: () => openDetail("docs", d) },
			h("div", { class: "t" }, d.split("/").pop()), h("div", { class: "s" }, d + (p.docs[d] === undefined ? " (없음)" : "")))),
		h("button", { class: "btn", onclick: addDoc }, "+ 문서 추가"));
	const detail = h("div");
	if (cur) {
		const mode = state.sel.docMode || "view";
		const text = p.docs[cur] ?? "";
		detail.append(h("div", { class: "row" },
			h("button", { class: "btn small" + (mode === "view" ? " primary" : ""), onclick: () => { state.sel.docMode = "view"; render(); } }, "미리보기"),
			h("button", { class: "btn small" + (mode === "edit" ? " primary" : ""), onclick: () => { state.sel.docMode = "edit"; render(); } }, "편집")));
		if (mode === "edit") {
			const ta = h("textarea", { class: "input doc-edit", spellcheck: false });
			ta.value = text;
			ta.addEventListener("input", () => {
				p.docs[cur] = ta.value;
				p.touchDoc(cur);
				changed();
			});
			detail.append(ta);
		} else detail.append(h("article", { class: "md", html: markdownToHtml(text) }));
	}
	split(v, list, detail, cur ? cur.split("/").pop() : "");
}

async function addDoc() {
	const p = state.project;
	const path = await promptBox("문서 경로 (저장소 기준, .md)", "docs/story/notes.md");
	if (!path) return;
	if (!path.endsWith(".md")) return toast("Markdown(.md) 경로만", true);
	const docs = arr(p.profile.docs);
	if (!docs.includes(path)) docs.push(path);
	p.profile.docs = docs;
	p.touch("profile");
	if (p.docs[path] === undefined) {
		p.docs[path] = "# 새 문서\n";
		p.touchDoc(path);
	}
	changed();
	openDetail("docs", path);
}

// ── 장·미션 ──
const STATUS = ["playable", "outline"];
const TYPE_FIELDS = {
	talk: ["dialogue"], event: [], reach: ["pos", "at", "radius", "map"], defeat_group: ["group"], defeat_boss: ["group", "retreat_at"],
	defeat_count: ["group", "count"], defend: ["target", "seconds"], escort: ["target", "to"], destroy: ["group"], collect: ["group", "count"], flag: ["flag"],
};

function dialogueIds(kinds) {
	const p = state.project;
	return p.ids("dialogue").filter((d) => !kinds || kinds.includes(String(p.items.dialogue[d].kind || "")));
}

function renderFlow(v) {
	const p = state.project;
	const sel = state.sel.flow || {};
	const list = h("div", { class: "tree" });
	list.append(h("div", { class: "row wrap" },
		h("button", { class: "btn small", onclick: addChapter }, "+ 장"),
		h("button", { class: "btn small", onclick: addMission }, "+ 미션"),
		h("button", { class: "btn small", onclick: addObjective }, "+ 목표"),
		h("button", { class: "btn small", onclick: () => move(-1), title: "위로" }, "▲"),
		h("button", { class: "btn small", onclick: () => move(1), title: "아래로" }, "▼"),
		h("button", { class: "btn small danger", onclick: delSelected }, "삭제")));
	const isSel = (s) => s.kind === sel.kind && (s.kind === "objective" ? s.mission === sel.mission && s.index === sel.index : s.id === sel.id);
	const node = (s, text, cls, depth) => h("button", { class: `node d${depth} ${cls || ""}${isSel(s) ? " on" : ""}`, onclick: () => openDetail("flow", s) }, text);
	const open = state.sel.flowOpen || (state.sel.flowOpen = {});
	const missionItems = (mid, depth) => {
		const m = p.get("mission", mid) || {};
		const items = [node({ kind: "mission", id: mid }, `${m.kind === "sub" ? "◇" : "◆"} ${mid}  ${m.title || (p.get("mission", mid) ? "" : "(없음!)")}`, m.kind === "sub" ? "sub" : "", depth)];
		if (open["m:" + mid] || (sel.mission === mid)) {
			arr(m.objectives).forEach((o, i) => items.push(node({ kind: "objective", mission: mid, index: i }, `${i + 1}. [${o.type}] ${o.text || o.id}`, "obj", depth + 1)));
		}
		items.push(h("button", { class: "fold d" + depth, onclick: () => { open["m:" + mid] = !open["m:" + mid]; render(); } }, open["m:" + mid] ? "목표 접기" : `목표 ${arr(m.objectives).length}개`));
		return items;
	};
	for (const cid of p.chapterOrder()) {
		const c = p.items.chapter[cid];
		const playable = c.status === "playable";
		list.append(node({ kind: "chapter", id: cid }, `${cid}  ${c.title || ""}${playable ? "" : "  · 줄거리만"}`, playable ? "ch" : "ch outline", 0));
		const isOpen = open["c:" + cid] ?? (playable || p.missionsOf(cid).includes(sel.id) || p.missionsOf(cid).includes(sel.mission));
		if (isOpen) for (const mid of p.missionsOf(cid)) list.append(...missionItems(mid, 1));
		if (p.missionsOf(cid).length) list.append(h("button", { class: "fold d0", onclick: () => { open["c:" + cid] = !isOpen; render(); } }, isOpen ? "미션 접기" : `미션 ${p.missionsOf(cid).length}개`));
	}
	const loose = p.looseMissions();
	if (loose.length) {
		list.append(h("div", { class: "group-label" }, "(장 없음)"));
		for (const mid of loose) list.append(...missionItems(mid, 1));
	}
	split(v, list, flowDetail(sel), sel.kind === "objective" ? `목표 ${sel.index + 1} / ${sel.mission}` : sel.id ? `${sel.kind === "chapter" ? "장" : "미션"} ${sel.id}` : "");
}

function flowDetail(sel) {
	const p = state.project;
	if (sel.kind === "chapter") {
		const c = p.get("chapter", sel.id);
		if (!c) return h("div", { class: "empty" }, "없음");
		return fieldForm(c, [
			{ key: "id", label: "ID", readonly: true },
			{ key: "number", label: "번호 (순서)", type: "int" },
			{ key: "title", label: "제목" },
			{ key: "status", label: "상태", type: "enum", options: STATUS, hint: "playable = 미션까지 있어 게임에서 진행" },
			{ key: "synopsis", label: "줄거리", type: "multiline", rows: 5 },
			{ key: "missions", label: "메인 미션 (순서)", type: "csv", readonly: true, hint: "목록에서 ▲▼" },
			{ key: "sub_missions", label: "서브 미션", type: "csv", readonly: true, hint: "미션의 장·종류로 정해짐" },
			{ key: "opening_event", label: "장 시작 이벤트씬", type: "ref", options: dialogueIds(["event"]) },
			{ key: "ending_event", label: "장 끝 이벤트씬", type: "ref", options: dialogueIds(["event"]) },
			{ key: "next", label: "다음 장", type: "ref", options: p.chapterOrder() },
			{ key: "planned", label: "예정 사건 (줄마다)", type: "lines", rows: 4 },
			{ key: "base_events", label: "거점 이벤트", type: "json", hint: "[{id, after: 미션, dialogue, unlocks}]" },
		], () => { p.touch("chapter", sel.id); changed(); });
	}
	if (sel.kind === "mission") {
		const m = p.get("mission", sel.id);
		if (!m) return h("div", { class: "empty" }, "없음");
		const defs = [
			{ key: "id", label: "ID", readonly: true },
			{ key: "chapter", label: "장", type: "ref", options: p.chapterOrder() },
			{ key: "kind", label: "종류", type: "enum", options: ["main", "sub"], labels: { main: "main (메인)", sub: "sub (서브·퀘스트)" } },
			{ key: "title", label: "제목" },
			{ key: "summary", label: "설명", type: "multiline" },
			{ key: "map", label: "맵 씬", hint: "res://…tscn, 없으면 비움" },
		];
		if (Object.keys(p.regions).length) defs.push({ key: "region", label: "지역", type: "ref", options: Object.keys(p.regions) });
		defs.push(
			{ key: "time", label: "시작 시각", type: "json", rows: 2, hint: "{hour, speed}" },
			{ key: "weather", label: "날씨" },
			{ key: "start", label: "시작 방식 (서브)", type: "ref", options: ["dialogue", "auto"] },
			{ key: "requires", label: "조건", type: "json", rows: 3, hint: "{missions, flags, chapter}" },
			{ key: "briefing", label: "브리핑 대화", type: "ref", options: dialogueIds(["dialogue"]) },
			{ key: "opening_event", label: "시작 이벤트씬", type: "ref", options: dialogueIds(["event"]) },
			{ key: "debrief", label: "후일담 대화", type: "ref", options: dialogueIds(["dialogue"]) },
			{ key: "spawns", label: "배치 (player · npcs · enemies)", type: "json", rows: 10, hint: "npcs: {character, dialogue, pos/at}, enemies: {enemy, group, pos/at, appear_with}" },
			{ key: "radio", label: "무전", type: "json", rows: 4 },
			{ key: "fail", label: "실패 조건", type: "json", rows: 2 },
			{ key: "rewards", label: "보상", type: "json", rows: 4 });
		const npcs = arr(obj(m.spawns).npcs).map((n) => `${p.characterName(n.character)}(${n.dialogue})`).join(", ") || "-";
		return h("div", {},
			fieldForm(m, defs, (k) => {
				p.touch("mission", sel.id);
				if (k === "chapter" || k === "kind") p.syncMembership(sel.id);
				changed();
				if (k === "chapter" || k === "kind") render();
			}),
			h("div", { class: "hint block" }, `인물: ${npcs}`, h("br"), `인물 ID: ${Object.keys(p.characters).join(", ")}`, h("br"), `적 종류: ${Object.keys(p.enemies).join(", ") || "-"}`));
	}
	if (sel.kind === "objective") {
		const m = p.get("mission", sel.mission);
		const o = m && arr(m.objectives)[sel.index];
		if (!o) return h("div", { class: "empty" }, "없음");
		const fieldOf = (k) => ({
			dialogue: { key: "dialogue", label: "끝내는 대화", type: "ref", options: dialogueIds(["dialogue"]) },
			pos: { key: "pos", label: "위치 [x, y, z]", type: "json", rows: 1 },
			at: { key: "at", label: "마커 이름" },
			radius: { key: "radius", label: "반경(m)", type: "float" },
			seconds: { key: "seconds", label: "시간(초)", type: "float" },
			retreat_at: { key: "retreat_at", label: "후퇴 체력 비율", type: "float" },
			count: { key: "count", label: "수", type: "int" },
			group: { key: "group", label: "적 무리 (spawns 의 group)" },
			map: { key: "map", label: "맵 (비우면 어디서나)" },
		}[k] || { key: k, label: k });
		const defs = [
			{ key: "id", label: "ID", hint: "대화 action objective 가 이 ID 를 씀" },
			{ key: "type", label: "종류", type: "enum", options: OBJECTIVE_TYPES },
			{ key: "text", label: "HUD 문구" },
			...(TYPE_FIELDS[o.type] || []).map(fieldOf),
			{ key: "event", label: "시작할 때 이벤트씬", type: "ref", options: dialogueIds(["event"]) },
			{ key: "event_delay", label: "이벤트씬 지연(초)", type: "float" },
			{ key: "marker", label: "목표 표시", type: "json", rows: 1, hint: "{node} / {pos} / {at}" },
			{ key: "set_flags", label: "끝나면 켤 플래그", type: "json", rows: 2 },
			{ key: "weather", label: "날씨 바꾸기" },
			{ key: "optional", label: "보너스 목표", type: "bool" },
		];
		return fieldForm(o, defs, (k) => {
			p.touch("mission", sel.mission);
			changed();
			if (k === "type") render();
		});
	}
	return h("div", { class: "empty" }, "왼쪽에서 장·미션·목표를 고르세요.");
}

function selChapter() {
	const p = state.project, s = state.sel.flow || {};
	if (s.kind === "chapter") return s.id;
	const m = p.get("mission", s.kind === "mission" ? s.id : s.mission);
	return m ? String(m.chapter || "") : "";
}

async function addChapter() {
	const p = state.project;
	const n = Object.keys(p.items.chapter).length + 1;
	const id = await promptBox("새 장 ID", "ch" + String(n).padStart(2, "0"), "영문 소문자·숫자·밑줄·점");
	if (!id) return;
	const err = p.create("chapter", id, { number: n, title: `제${n}장 ` });
	if (err) return toast(err, true);
	changed();
	openDetail("flow", { kind: "chapter", id });
}

async function addMission() {
	const p = state.project;
	const cid = selChapter();
	const num = Number(obj(p.get("chapter", cid)).number || 0);
	const suggestion = cid ? `m${String(num).padStart(2, "0")}_${String(p.missionsOf(cid).length + 1).padStart(2, "0")}` : "s_new";
	const id = await promptBox(cid ? `새 미션 ID (장 ${cid})` : "새 미션 ID (장 없음)", suggestion);
	if (!id) return;
	const err = p.create("mission", id, { chapter: cid, kind: cid ? "main" : "sub" });
	if (err) return toast(err, true);
	p.syncMembership(id);
	changed();
	openDetail("flow", { kind: "mission", id });
}

function addObjective() {
	const p = state.project, s = state.sel.flow || {};
	const mid = s.kind === "mission" ? s.id : s.kind === "objective" ? s.mission : "";
	if (!mid) return toast("목표를 넣을 미션을 먼저 고르세요", true);
	const m = p.get("mission", mid);
	const objs = arr(m.objectives);
	const at = s.kind === "objective" ? s.index + 1 : objs.length;
	objs.splice(at, 0, { id: "obj_" + (objs.length + 1), type: "reach", text: "새 목표" });
	m.objectives = objs;
	p.touch("mission", mid);
	changed();
	openDetail("flow", { kind: "objective", mission: mid, index: at });
}

function move(dir) {
	const p = state.project, s = state.sel.flow || {};
	if (s.kind === "objective") {
		const m = p.get("mission", s.mission), objs = arr(m.objectives), j = s.index + dir;
		if (j < 0 || j >= objs.length) return;
		[objs[s.index], objs[j]] = [objs[j], objs[s.index]];
		s.index = j;
		p.touch("mission", s.mission);
	} else if (s.kind === "mission") {
		const m = p.get("mission", s.id), c = p.get("chapter", String(m.chapter || ""));
		if (!c) return;
		const key = m.kind === "main" ? "missions" : "sub_missions", a = arr(c[key]), i = a.indexOf(s.id);
		if (i < 0 || i + dir < 0 || i + dir >= a.length) return;
		[a[i], a[i + dir]] = [a[i + dir], a[i]];
		p.touch("chapter", m.chapter);
	} else if (s.kind === "chapter") {
		const order = p.chapterOrder(), i = order.indexOf(s.id);
		if (i + dir < 0 || i + dir >= order.length) return;
		const a = p.items.chapter[s.id], b = p.items.chapter[order[i + dir]];
		const na = a.number ?? i + 1;
		a.number = b.number ?? i + 1 + dir;
		b.number = na;
		p.touch("chapter", s.id);
		p.touch("chapter", order[i + dir]);
	} else return;
	changed();
	render();
}

async function delSelected() {
	const p = state.project, s = state.sel.flow || {};
	if (s.kind === "objective") {
		arr(p.get("mission", s.mission).objectives).splice(s.index, 1);
		p.touch("mission", s.mission);
		state.sel.flow = { kind: "mission", id: s.mission };
	} else if (s.kind === "mission") {
		if (!(await confirmBox(`미션 ${s.id} 를 지울까요? (커밋할 때 파일도 지워짐)`, "지우기"))) return;
		const m = p.get("mission", s.id);
		m.chapter = "";
		p.remove("mission", s.id);
		p.syncMembership(s.id);
		state.sel.flow = {};
	} else if (s.kind === "chapter") {
		if (p.missionsOf(s.id).length) return toast("미션이 있는 장은 지울 수 없음 — 미션을 먼저 옮기거나 지우세요", true);
		if (!(await confirmBox(`장 ${s.id} 를 지울까요?`, "지우기"))) return;
		p.remove("chapter", s.id);
		state.sel.flow = {};
	} else return;
	state.detail = false;
	changed();
	render();
}

// ── 대사 ──
function renderDialogueTab(v) {
	const p = state.project;
	const f = state.sel.dlgFilter || (state.sel.dlgFilter = { q: "", kind: "" });
	const cur = state.sel.dialogue || "";
	const q = f.q.trim().toLowerCase();
	const items = p.ids("dialogue").filter((id) => {
		const d = p.items.dialogue[id];
		if (f.kind && d.kind !== f.kind) return false;
		return !q || id.toLowerCase().includes(q) || JSON.stringify(d.nodes || {}).toLowerCase().includes(q);
	});
	const search = h("input", { class: "input", placeholder: "찾기 (ID·대사)", value: f.q });
	search.addEventListener("input", () => { f.q = search.value; renderListOnly(); });
	const kindSel = h("select", { class: "input", onchange: (e) => { f.kind = e.target.value; render(); } },
		[["", "전체"], ["dialogue", "대화"], ["event", "이벤트씬"], ["radio", "무전"]].map(([k, l]) => h("option", { value: k, selected: f.kind === k }, l)));
	const listBox = h("div", { class: "items" });
	const kindName = { dialogue: "대화", event: "이벤트씬", radio: "무전" };
	function renderListOnly() {
		clear(listBox);
		const qq = f.q.trim().toLowerCase();
		for (const id of p.ids("dialogue")) {
			const d = p.items.dialogue[id];
			if (f.kind && d.kind !== f.kind) continue;
			if (qq && !id.toLowerCase().includes(qq) && !JSON.stringify(d.nodes || {}).toLowerCase().includes(qq)) continue;
			const users = p.dialogueUsers(id).length;
			listBox.append(h("button", { class: "item" + (id === cur ? " on" : ""), onclick: () => openDetail("dialogue", id) },
				h("div", { class: "t" }, id), h("div", { class: "s" }, `${kindName[d.kind] || d.kind} · 줄 ${Object.keys(obj(d.nodes)).length}${users ? "" : " · 안 쓰임"}`)));
		}
	}
	renderListOnly();
	void items;
	const list = h("div", {}, h("div", { class: "row" }, search, kindSel), h("div", { class: "row wrap" },
		h("button", { class: "btn small", onclick: newDialogue }, "+ 새 대화"),
		cur ? h("button", { class: "btn small", onclick: () => duplicateDialogue(cur) }, "복제") : null,
		cur ? h("button", { class: "btn small danger", onclick: () => deleteDialogue(cur) }, "삭제") : null), listBox);
	const detail = cur && p.get("dialogue", cur) ? renderDialogue(p, cur, { changed, render, toast, openDialogue: (id) => openDetail("dialogue", id) }) : h("div", { class: "empty" }, "대화를 고르세요.");
	split(v, list, detail, cur);
}

async function newDialogue() {
	const p = state.project;
	const id = await promptBox("새 대화 ID", "new_dialogue", "이벤트씬은 ev_ 로 시작하면 찾기 쉬움");
	if (!id) return;
	const err = p.create("dialogue", id, id.startsWith("ev_") || id.includes("_ev_") ? { kind: "event" } : {});
	if (err) return toast(err, true);
	changed();
	openDetail("dialogue", id);
}

async function duplicateDialogue(src) {
	const p = state.project;
	const id = await promptBox("복제할 새 ID", src + "_copy");
	if (!id) return;
	const err = p.create("dialogue", id);
	if (err) return toast(err, true);
	p.items.dialogue[id] = JSON.parse(JSON.stringify(p.items.dialogue[src]));
	changed();
	openDetail("dialogue", id);
}

async function deleteDialogue(id) {
	const p = state.project;
	const users = p.dialogueUsers(id);
	if (!(await confirmBox(`대화 ${id} 를 지울까요?${users.length ? "\n쓰는 곳: " + users.join(", ") : ""}`, "지우기"))) return;
	p.remove("dialogue", id);
	state.sel.dialogue = "";
	state.detail = false;
	changed();
	render();
}

// ── 인물·적·지역 ──
function renderCast(v) {
	const p = state.project;
	const cur = state.sel.cast || "";
	const uses = (cid) => {
		let n = 0;
		for (const did of p.ids("dialogue")) for (const node of Object.values(obj(p.items.dialogue[did].nodes))) if (node && node.speaker === cid) n++;
		return n;
	};
	const ids = Object.keys(p.characters).sort();
	const list = h("div", {},
		h("div", { class: "row wrap" },
			h("button", { class: "btn small", onclick: addCharacter }, "+ 인물"),
			h("button", { class: "btn small", onclick: () => openDetail("cast", "@enemies") }, "적 종류"),
			h("button", { class: "btn small", onclick: () => openDetail("cast", "@regions") }, "지역")),
		h("div", { class: "items" }, ids.map((id) => h("button", { class: "item" + (id === cur ? " on" : ""), onclick: () => openDetail("cast", id) },
			h("div", { class: "t" }, p.characterName(id)), h("div", { class: "s" }, `${id} · 대사 ${uses(id)}줄`)))));
	let detail;
	if (cur === "@enemies" || cur === "@regions") {
		const key = cur.slice(1);
		const raw = p.single[key];
		detail = fieldForm(raw, [{ key, label: key === "enemies" ? "적 종류 {id: {name, scene?, set?, animator?}}" : "지역 [{id, name, desc}]", type: "json", rows: 18 }],
			() => { p.touch(key); changed(); }, key === "enemies" ? "data/story/enemies.json" : "data/story/regions.json");
	} else if (p.characters[cur]) {
		detail = h("div", {},
			fieldForm(p.characters[cur], [
				{ key: "name", label: "이름 (대사창에 보임)" },
				{ key: "faction", label: "소속" },
				{ key: "expressions", label: "표정", type: "csv", hint: "쉼표로. 비우면 표정 없음" },
				{ key: "portrait", label: "초상화 폴더" },
				{ key: "short", label: "짧은 이름" },
			], () => { p.touch("characters"); changed(); }, `인물 ${cur} · 대사 ${uses(cur)}줄`),
			h("button", { class: "btn danger", onclick: () => deleteCharacter(cur, uses(cur)) }, "인물 삭제"));
	} else detail = h("div", { class: "empty" }, "인물을 고르세요.");
	split(v, list, detail, cur.startsWith("@") ? (cur === "@enemies" ? "적 종류" : "지역") : p.characterName(cur));
}

async function addCharacter() {
	const p = state.project;
	const id = await promptBox("새 인물 ID", "new_character", "영문 소문자·숫자·밑줄·점");
	if (!id) return;
	if (!p.isValidId(id) || p.characters[id]) return toast("ID 가 잘못됐거나 이미 있음: " + id, true);
	p.characters[id] = { name: id, expressions: [] };
	p.touch("characters");
	changed();
	openDetail("cast", id);
}

async function deleteCharacter(id, uses) {
	const p = state.project;
	if (!(await confirmBox(`인물 ${id} 를 지울까요?${uses ? `\n대사 ${uses}줄이 이 인물을 씀 (점검 오류가 됨)` : ""}`, "지우기"))) return;
	delete p.characters[id];
	p.touch("characters");
	state.sel.cast = "";
	state.detail = false;
	changed();
	render();
}

// ── 점검·대본 ──
function renderCheck(v) {
	const p = state.project;
	const val = new StoryValidator(p);
	const issues = val.check().slice().sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
	const chapters = p.chapterOrder();
	const curCh = state.sel.flowCh && chapters.includes(state.sel.flowCh) ? state.sel.flowCh : chapters[0];
	const script = h("pre", { class: "script" }, curCh ? val.flowText(curCh) : "");
	v.append(h("div", { class: "check" },
		h("section", { class: "pane" },
			h("h3", {}, "점검 ", h("span", { class: val.errorCount() ? "bad" : "good" }, issues.length ? `오류 ${val.errorCount()} · 경고 ${val.warnCount()}` : "문제 없음")),
			h("div", { class: "hint" }, "저장하지 않은 변경까지 포함. 누르면 그 항목으로 이동"),
			h("div", { class: "items" }, issues.map((i) => h("button", { class: "item issue " + i.level, onclick: () => gotoIssue(i) }, issueText(i))))),
		h("section", { class: "pane" },
			h("div", { class: "row" }, h("h3", {}, "대본"),
				h("select", { class: "input", onchange: (e) => { state.sel.flowCh = e.target.value; render(); } }, chapters.map((c) => h("option", { value: c, selected: c === curCh }, c))),
				h("button", { class: "btn small", onclick: () => navigator.clipboard.writeText(script.textContent).then(() => toast("복사함")) }, "복사")),
			script)));
}

function gotoIssue(i) {
	if (!i.id) return setTab("settings");
	if (i.kind === "chapter" || i.kind === "mission") {
		state.tab = "flow";
		openDetail("flow", { kind: i.kind, id: i.id });
	} else if (i.kind === "dialogue") {
		state.tab = "dialogue";
		openDetail("dialogue", i.id);
	}
}

// ── 커밋 ──
function renderCommit(v) {
	if (DESKTOP) return renderDesktopGit(v);
	const p = state.project;
	const changes = p.changes();
	const paths = Object.keys(changes).sort();
	const val = new StoryValidator(p);
	val.check();
	const msg = h("input", { class: "input", placeholder: "커밋 메시지 (예: docs: 4장 줄거리 / feat: m04_01 미션 데이터)", value: state.sel.commitMsg || "" });
	msg.addEventListener("input", () => (state.sel.commitMsg = msg.value));
	const head = state.head || {};
	v.append(h("div", { class: "commit" },
		h("div", { class: "card" },
			h("div", { class: "hint" }, `${state.repo.owner}/${state.repo.name} · ${state.repo.branch} · 기준 ${String(head.sha || "").slice(0, 7)} ${String(head.message || "").split("\n")[0]}`),
			state.offline ? h("div", { class: "warn" }, "오프라인: GitHub 에 연결되면 커밋할 수 있음. 변경은 이 기기에 저장됨") : null),
		state.conflicts.length ? h("div", { class: "card warn" },
			h("b", {}, "원격에서 바뀐 파일에 이 기기 초안이 있음"),
			state.conflicts.map((c) => h("div", { class: "row" }, h("code", {}, c.path),
				h("button", { class: "btn small", onclick: () => resolveConflict(c, true) }, "내 초안 쓰기"),
				h("button", { class: "btn small", onclick: () => resolveConflict(c, false) }, "원격 것 쓰기")))) : null,
		h("div", { class: "card" },
			h("h3", {}, paths.length ? `바뀐 파일 ${paths.length}개` : "바뀐 것이 없음"),
			paths.map((path) => h("div", { class: "change" }, h("span", { class: "tag " + (changes[path] === null ? "del" : p.original[path] === undefined ? "add" : "mod") },
				changes[path] === null ? "삭제" : p.original[path] === undefined ? "새로" : "수정"), h("code", {}, path), h("span", { class: "hint" }, diffStat(p.original[path], changes[path])))),
			paths.length ? h("div", { class: val.errorCount() ? "warn" : "hint" }, val.errorCount() ? `점검 오류 ${val.errorCount()}개가 있는 채로 커밋됩니다 (「점검」 탭)` : `점검 오류 없음 · 경고 ${val.warnCount()}`) : null),
		h("div", { class: "card" }, msg,
			h("div", { class: "row wrap" },
				h("button", { class: "btn primary", disabled: !paths.length || state.offline, onclick: () => doCommit(msg.value) }, "커밋하고 올리기"),
				h("button", { class: "btn danger", disabled: !paths.length, onclick: discardAll }, "변경 모두 버리기")),
			h("div", { class: "hint" }, "스토리 데이터·문서만 이 저장소의 브랜치에 바로 커밋합니다. 게임 세션에는 docs/GAME_SESSION_PROMPTS.md 3번 프롬프트로 알리세요."))));
}

function diffStat(a, b) {
	if (b === null) return "";
	const A = (a || "").split("\n"), B = b.split("\n");
	const setA = new Map();
	for (const l of A) setA.set(l, (setA.get(l) || 0) + 1);
	let same = 0;
	for (const l of B) if (setA.get(l)) { setA.set(l, setA.get(l) - 1); same++; }
	return `+${B.length - same} −${A.length - same}`;
}

function resolveConflict(c, mine) {
	if (mine) {
		const err = state.project.applyText(c.path, c.text);
		if (err) toast(err, true);
	}
	state.conflicts = state.conflicts.filter((x) => x !== c);
	changed();
	render();
}

async function discardAll() {
	if (!(await confirmBox("저장하지 않은 변경을 모두 버리고 마지막으로 받은 데이터로 돌아갈까요?", "버리기"))) return;
	const key = repoKey(state.repo);
	const cache = await loadRepoCache(key);
	if (cache) {
		cache.drafts = {};
		cache.draftBase = {};
		await saveRepoCache(key, cache);
	}
	state.conflicts = [];
	await openRepo(state.repo);
}

async function doCommit(message) {
	const p = state.project;
	message = (message || "").trim();
	if (!message) return toast("커밋 메시지를 쓰세요", true);
	const changes = p.changes();
	if (!Object.keys(changes).length) return toast("바뀐 것이 없음");
	const gh = new GitHub(state.settings.token);
	const r = state.repo;
	let base = state.head;
	state.busy = true;
	updateStatus();
	try {
		let result;
		try {
			result = await gh.commit(r.owner, r.name, r.branch, base, changes, message);
		} catch (e) {
			if (!(e instanceof GitHubError) || e.code !== "not_fast_forward") throw e;
			// 그사이 다른 커밋이 올라옴: 내가 고친 파일이 원격에서도 바뀌었는지 확인
			const newHead = await gh.headCommit(r.owner, r.name, r.branch);
			const t = await gh.tree(r.owner, r.name, newHead.tree);
			const shaOf = Object.fromEntries(t.entries.map((x) => [x.path, x.sha]));
			const clash = Object.keys(changes).filter((path) => (shaOf[path] || null) !== (state.meta[path] || null));
			if (clash.length && !(await confirmBox(`그사이 GitHub 에서 같은 파일이 바뀌었습니다:\n${clash.join("\n")}\n\n내 내용으로 덮어쓸까요? (취소하면 커밋 안 함 — 「⟳」로 다시 받은 뒤 고치세요)`, "덮어쓰기"))) {
				state.busy = false;
				updateStatus();
				return;
			}
			base = newHead;
			result = await gh.commit(r.owner, r.name, r.branch, base, changes, message);
		}
		for (const [path, text] of Object.entries(changes)) {
			if (text === null) delete state.meta[path];
			else state.meta[path] = await gitBlobSha(text);
		}
		p.markCommitted(changes);
		state.head = { sha: result.sha, tree: result.tree, message };
		const key = repoKey(r);
		const cache = (await loadRepoCache(key)) || {};
		cache.head = state.head;
		cache.files = Object.fromEntries(Object.keys(p.original).map((path) => [path, { sha: state.meta[path], text: p.original[path] }]));
		cache.drafts = {};
		cache.draftBase = {};
		await saveRepoCache(key, cache);
		state.sel.commitMsg = "";
		toast(`커밋함: ${result.sha.slice(0, 7)} (${Object.keys(changes).length}개 파일)`);
	} catch (e) {
		toast("커밋 실패: " + e.message, true);
	}
	state.busy = false;
	render();
}

// ── PC 판: 저장·Git ──
// 저장 = 바뀐 파일을 PC 폴더에 씀. 커밋 = git status 의 스토리 데이터·문서만 커밋 (게임 코드 등 다른 파일은 그대로)
let gitInfo = null;   // 마지막 git status
let gitLog = "";      // 마지막 git 출력

async function refreshGit() {
	if (!state.repo || !state.repo.path) return;
	try {
		gitInfo = { ...(await local.status(state.repo.path)), repo: state.repo.path };
	} catch (e) {
		gitInfo = { repo: state.repo.path, git: false, error: e.message };
	}
	if (state.tab === "commit" && !state.help) render();
}

export async function saveToDisk(force = false) {
	const p = state.project;
	if (!p || !state.repo || !state.repo.path) return false;
	const changes = p.changes();
	if (!Object.keys(changes).length) {
		toast("저장할 변경이 없음");
		return true;
	}
	const expect = {};
	for (const path of Object.keys(changes)) expect[path] = state.meta[path] || "";
	let result;
	try {
		result = await local.save(state.repo.path, changes, expect, force);
	} catch (e) {
		if (e instanceof LocalError && e.status === 409 && !force) {
			const clash = (e.body.clash || []).join("\n");
			if (await confirmBox(`그사이 디스크에서 바뀐 파일이 있습니다 (게임 세션·git pull 등):\n${clash}\n\n내 내용으로 덮어쓸까요? (취소하면 저장 안 함 — ⟳ 로 다시 읽은 뒤 고치세요)`, "덮어쓰기")) return saveToDisk(true);
			return false;
		}
		toast("저장 실패: " + e.message, true);
		return false;
	}
	for (const [path, sha] of Object.entries(result.shas)) {
		if (sha === null) delete state.meta[path];
		else state.meta[path] = sha;
	}
	p.markCommitted(changes);
	state.head = result.head;
	const key = repoKey(state.repo);
	const cache = (await loadRepoCache(key)) || {};
	cache.head = state.head;
	cache.files = Object.fromEntries(Object.keys(p.original).map((path) => [path, { sha: state.meta[path], text: p.original[path] }]));
	cache.drafts = {};
	cache.draftBase = {};
	await saveRepoCache(key, cache);
	toast(`저장함: ${Object.keys(changes).length}개 파일`);
	render();
	refreshGit();
	return true;
}

async function gitAction(name, fn, append = false) {
	state.busy = true;
	updateStatus();
	try {
		const r = await fn();
		gitLog = (append ? gitLog + "\n" : "") + ((r && r.log) || "");
		toast(name + " 완료");
		return true;
	} catch (e) {
		gitLog = (append ? gitLog + "\n" : "") + ((e.body && e.body.log) || e.message);
		toast(name + " 실패 — 아래 기록", true);
		return false;
	} finally {
		state.busy = false;
		updateStatus();
		await refreshGit();
		render();
	}
}

function renderDesktopGit(v) {
	const p = state.project;
	const repo = state.repo;
	const changes = p.changes();
	const paths = Object.keys(changes).sort();
	const val = new StoryValidator(p);
	val.check();
	if (!gitInfo || gitInfo.repo !== repo.path) {
		gitInfo = { repo: repo.path, loading: true };
		local.status(repo.path).then((g) => { gitInfo = { ...g, repo: repo.path }; if (state.tab === "commit" && !state.help) render(); })
			.catch((e) => { gitInfo = { repo: repo.path, git: false, error: e.message }; render(); });
	}
	const g = gitInfo;
	const story = g.story || [];
	const msg = h("input", { class: "input", placeholder: "커밋 메시지 (예: docs: 4장 줄거리 / feat: m04_01 미션 데이터)", value: state.sel.commitMsg || "" });
	msg.addEventListener("input", () => (state.sel.commitMsg = msg.value));
	const pushAfter = h("input", { type: "checkbox", checked: state.sel.pushAfter !== false });
	pushAfter.addEventListener("change", () => (state.sel.pushAfter = pushAfter.checked));
	const head = state.head || {};
	const branchLine = g.loading ? "git 상태 읽는 중…" : g.git === false ? (g.error || "Git 저장소가 아니거나 git 이 설치돼 있지 않음 (저장만 됨)")
		: `브랜치 ${g.branch}${g.upstream ? ` → ${g.upstream}` : ""}${g.ahead ? ` · 올릴 커밋 ${g.ahead}` : ""}${g.behind ? ` · 받을 커밋 ${g.behind}` : ""}`;
	const busy = state.busy;
	v.append(h("div", { class: "commit" },
		h("div", { class: "card" },
			h("div", {}, h("b", {}, repo.name), " ", h("span", { class: "hint" }, repo.path)),
			h("div", { class: "hint" }, `${branchLine} · 마지막 커밋 ${head.message || "-"}`),
			h("div", { class: "row wrap" },
				h("button", { class: "btn small", disabled: busy || g.git === false, onclick: () => gitAction("풀", () => local.pull(repo.path)).then((ok) => ok && openRepo(repo)) }, "풀 (rebase)"),
				h("button", { class: "btn small", disabled: busy || g.git === false, onclick: () => gitAction("푸시", () => local.push(repo.path)) }, "푸시"),
				h("button", { class: "btn small", disabled: busy, title: "Studio 의 점검 코드를 addons/story_core/, tools/story_tool.gd, data/story/FORMAT.md 로 복사", onclick: async () => {
					if (!(await confirmBox("게임 도구 갱신: Studio 의 점검 코드와 형식 문서를 이 저장소에 복사합니다\n(addons/story_core/, tools/story_tool.gd, data/story/FORMAT.md). 복사한 뒤 게임 쪽에서 커밋하세요.", "복사"))) return;
					gitAction("게임 도구 갱신", async () => { const r = await local.vendor(repo.path); return { log: "복사함:\n" + r.written.join("\n") }; });
				} }, "게임 도구 갱신"))),
		state.conflicts.length ? h("div", { class: "card warn" },
			h("b", {}, "디스크에서 바뀐 파일에 저장 안 한 변경이 있음"),
			state.conflicts.map((c) => h("div", { class: "row" }, h("code", {}, c.path),
				h("button", { class: "btn small", onclick: () => resolveConflict(c, true) }, "내 변경 쓰기"),
				h("button", { class: "btn small", onclick: () => resolveConflict(c, false) }, "디스크 것 쓰기")))) : null,
		h("div", { class: "card" },
			h("h3", {}, paths.length ? `저장 안 한 변경 ${paths.length}개` : "저장 안 한 변경 없음"),
			paths.map((path) => h("div", { class: "change" }, h("span", { class: "tag " + (changes[path] === null ? "del" : p.original[path] === undefined ? "add" : "mod") },
				changes[path] === null ? "삭제" : p.original[path] === undefined ? "새로" : "수정"), h("code", {}, path), h("span", { class: "hint" }, diffStat(p.original[path], changes[path])))),
			h("div", { class: "row wrap" },
				h("button", { class: "btn primary", disabled: !paths.length || busy, onclick: () => saveToDisk() }, "저장 (Ctrl+S)"),
				h("button", { class: "btn danger", disabled: !paths.length || busy, onclick: discardAll }, "변경 모두 버리기")),
			h("div", { class: "hint" }, "저장 안 한 변경은 이 PC 에 초안으로 남아, 프로그램을 닫았다 열어도 그대로입니다.")),
		h("div", { class: "card" },
			h("h3", {}, g.git === false ? "Git" : story.length ? `커밋할 스토리 데이터·문서 ${story.length}개` : "커밋할 것 없음"),
			story.map((f) => h("div", { class: "change" }, h("span", { class: "tag " + (f.status === "D" ? "del" : f.status === "??" || f.status === "A" ? "add" : "mod") }, f.status === "D" ? "삭제" : f.status === "??" || f.status === "A" ? "새로" : "수정"), h("code", {}, f.path))),
			g.other ? h("div", { class: "hint" }, `그 밖의 변경 ${g.other}개(게임 작업 파일)는 여기서 커밋하지 않음`) : null,
			(paths.length || story.length) ? h("div", { class: val.errorCount() ? "warn" : "hint" }, val.errorCount() ? `점검 오류 ${val.errorCount()}개가 있는 채로 커밋됩니다 (「점검」 탭)` : `점검 오류 없음 · 경고 ${val.warnCount()}`) : null,
			msg,
			h("div", { class: "row wrap" },
				h("button", { class: "btn primary", disabled: busy || g.git === false || (!paths.length && !story.length), onclick: () => desktopCommit(msg.value, pushAfter.checked) }, paths.length ? "저장하고 커밋" : "커밋"),
				h("label", { class: "row" }, pushAfter, "커밋 뒤 푸시")),
			h("div", { class: "hint" }, "게임 세션에는 docs/GAME_SESSION_PROMPTS.md 3번 프롬프트로 알리세요.")),
		gitLog ? h("div", { class: "card" }, h("h3", {}, "git 기록"), h("pre", { class: "script" }, gitLog)) : null));
}

async function desktopCommit(message, push) {
	message = (message || "").trim();
	if (!message) return toast("커밋 메시지를 쓰세요", true);
	if (Object.keys(state.project.changes()).length && !(await saveToDisk())) return;
	const repo = state.repo;
	const st = await local.status(repo.path).catch(() => null);
	const paths = st && st.story ? st.story.map((f) => f.path) : [];
	if (!paths.length) return toast("커밋할 것이 없음");
	const ok = await gitAction("커밋", () => local.commit(repo.path, message, paths));
	if (!ok) return;
	state.sel.commitMsg = "";
	if (push) await gitAction("푸시", () => local.push(repo.path), true);
	state.head = await local.head(repo.path).catch(() => state.head);
	render();
}

// ── PC 판: 설정 ──
let scanResult = null;

async function addLocalRepo(path) {
	path = (path || "").trim();
	if (!path) return;
	const c = await local.check(path).catch((e) => ({ ok: false, error: e.message }));
	if (!c.ok) return toast("게임 저장소 폴더가 아님 (data/story/project.json 이 있는 폴더를 고르세요): " + path, true);
	const r = localRepo(c.path || path);
	const s = state.settings;
	if (!s.repos.some((x) => repoKey(x) === repoKey(r))) s.repos.push(r);
	saveSettings(s);
	fillRepoSelect();
	await openRepo(s.repos.find((x) => repoKey(x) === repoKey(r)));
}

function renderDesktopSettings(v) {
	const s = state.settings;
	const pathIn = h("input", { class: "input", placeholder: "폴더 경로 (예: C:\\Users\\hakgo\\like-a-hero)" });
	v.append(h("div", { class: "settings" },
		h("div", { class: "card" },
			h("h3", {}, "게임 저장소 폴더"),
			h("div", { class: "hint" }, "data/story/project.json 이 있는 게임 저장소 폴더. 고른 폴더의 파일을 직접 읽고 씁니다."),
			h("div", { class: "items" }, s.repos.length ? s.repos.map((r, i) => h("div", { class: "row repo-row" },
				h("button", { class: "item grow" + (state.repo && repoKey(state.repo) === repoKey(r) ? " on" : ""), onclick: () => openRepo(r) }, h("div", { class: "t" }, r.name), h("div", { class: "s" }, r.path)),
				h("button", { class: "btn small danger", title: "목록에서 빼기 (폴더는 그대로)", onclick: () => { s.repos.splice(i, 1); saveSettings(s); fillRepoSelect(); render(); } }, "✕")))
				: h("div", { class: "hint" }, "아직 없음 — 아래에서 폴더를 고르세요.")),
			h("div", { class: "row wrap" },
				h("button", { class: "btn primary", onclick: async () => {
					try {
						const r = await local.pick("게임 저장소 폴더 고르기 (data/story/project.json 이 있는 곳)");
						if (r.path) await addLocalRepo(r.path);
					} catch (e) {
						toast(e.message, true);
					}
				} }, "폴더 고르기…"),
				h("button", { class: "btn", onclick: async () => {
					scanResult = { loading: true };
					render();
					scanResult = await local.scan().catch((e) => ({ error: e.message }));
					render();
				} }, "내 폴더에서 찾기")),
			scanResult ? h("div", { class: "items" }, scanResult.loading ? h("div", { class: "hint" }, "찾는 중…")
				: scanResult.error ? h("div", { class: "err" }, scanResult.error)
				: scanResult.found.length ? scanResult.found.map((f) => h("div", { class: "row" }, h("code", { class: "grow" }, f),
					s.repos.some((r) => repoKey(r) === repoKey(localRepo(f))) ? h("span", { class: "hint" }, "추가됨") : h("button", { class: "btn small", onclick: () => addLocalRepo(f) }, "+ 추가")))
				: h("div", { class: "hint" }, "사용자 폴더 아래 3단계 안에서 찾지 못함 — 「폴더 고르기」나 경로를 직접 넣으세요.")) : null,
			h("div", { class: "row" }, pathIn, h("button", { class: "btn", onclick: () => addLocalRepo(pathIn.value) }, "경로로 추가"))),
		h("div", { class: "card" },
			h("h3", {}, "이 PC"),
			h("div", { class: "hint block" }, `Story Studio PC 판 ${VERSION}. 커밋·푸시는 이 PC 에 설치된 git(Git for Windows)과 그 로그인 설정을 씁니다. 저장 안 한 변경은 이 PC 에 초안으로 남습니다. 휴대폰에서는 웹 판(https://hakgonc.github.io/story-studio-web/)을 쓰세요.`),
			h("button", { class: "btn danger", onclick: async () => {
				if (!(await confirmBox("이 PC 의 Story Studio 설정·캐시·저장 안 한 변경을 모두 지울까요? (게임 저장소 파일은 그대로)", "지우기"))) return;
				try { localStorage.clear(); indexedDB.deleteDatabase("story-studio"); } catch (_) { /* 무시 */ }
				location.reload();
			} }, "이 PC 의 Studio 데이터 지우기"))));
}

// ── 설정 ──
function renderSettings(v) {
	if (DESKTOP) return renderDesktopSettings(v);
	const s = state.settings;
	const token = h("input", { class: "input", type: "password", value: s.token, placeholder: "github_pat_…", autocomplete: "off" });
	const repoRows = h("div", { class: "items" });
	const drawRepos = () => {
		clear(repoRows);
		s.repos.forEach((r, i) => {
			const o = h("input", { class: "input", value: r.owner, placeholder: "owner" });
			const n = h("input", { class: "input", value: r.name, placeholder: "저장소" });
			const b = h("input", { class: "input small-w", value: r.branch, placeholder: "branch" });
			const upd = () => { r.owner = o.value.trim(); r.name = n.value.trim(); r.branch = b.value.trim() || "main"; };
			[o, n, b].forEach((x) => x.addEventListener("input", upd));
			repoRows.append(h("div", { class: "row repo-row" }, o, n, b, h("button", { class: "btn small danger", onclick: () => { s.repos.splice(i, 1); drawRepos(); } }, "✕")));
		});
	};
	drawRepos();
	v.append(h("div", { class: "settings" },
		h("div", { class: "card" },
			h("h3", {}, "GitHub 토큰"),
			token,
			h("div", { class: "hint block" },
				"토큰은 이 기기 브라우저에만 저장되고 api.github.com 으로만 보냅니다. 만드는 법: ",
				h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener" }, "Fine-grained token 만들기"),
				" → Repository access: Only select repositories (like-a-hero, SHATTERCORE-AFTER-THE-FALL) → Permissions: Contents 「Read and write」 → 만든 토큰을 붙여 넣기. 휴대폰을 잃어버리면 GitHub 에서 토큰을 지우세요."),
			h("div", { class: "row wrap" },
				h("button", { class: "btn primary", onclick: async () => {
					s.token = token.value.trim();
					saveSettings(s);
					try {
						const u = await new GitHub(s.token).user();
						toast(`연결됨: ${u.login} — 저장소를 엽니다`);
						const repos = s.repos.filter((r) => r.owner && r.name);
						if (repos.length) await openRepo(repos.find((r) => repoKey(r) === s.current) || repos[0]);
					} catch (e) {
						toast(e.message, true);
					}
				} }, "저장하고 확인"))),
		h("div", { class: "card" },
			h("h3", {}, "게임 저장소"),
			h("div", { class: "hint" }, "owner / 저장소 이름 / 브랜치. story-data/1 로 전환된 저장소 (data/story/project.json 이 있어야 함)"),
			repoRows,
			h("div", { class: "row wrap" },
				h("button", { class: "btn small", onclick: () => { s.repos.push({ owner: "hakgonc", name: "", branch: "main" }); drawRepos(); } }, "+ 저장소"),
				h("button", { class: "btn primary", onclick: async () => {
					s.repos = s.repos.filter((r) => r.owner && r.name);
					saveSettings(s);
					fillRepoSelect();
					toast("저장함");
					if (s.token && s.repos.length) await openRepo(s.repos.find((r) => repoKey(r) === s.current) || s.repos[0]);
				} }, "저장하고 열기"))),
		h("div", { class: "card" },
			h("h3", {}, "이 기기"),
			h("div", { class: "hint block" }, `Story Studio 웹 ${VERSION}. 불러온 데이터와 커밋 전 변경은 이 기기에 저장되어 오프라인에서도 열립니다. 홈 화면에 추가하면 앱처럼 쓸 수 있습니다.`),
			h("button", { class: "btn danger", onclick: async () => {
				if (!(await confirmBox("이 기기의 토큰·캐시·커밋 전 변경을 모두 지울까요?", "지우기"))) return;
				try { localStorage.clear(); indexedDB.deleteDatabase("story-studio"); } catch (_) { /* 무시 */ }
				location.reload();
			} }, "이 기기 데이터 지우기"))));
}

window.addEventListener("beforeunload", () => { saveDrafts(); });
