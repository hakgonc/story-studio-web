// 대사·이벤트씬 편집: 위에 대화 정보, 흐름 그래프(가로로 스크롤), 아래 줄 카드(진행 순서). 휴대폰은 카드로 고친다.
import { h, fieldForm, confirmBox } from "./ui.js";
import { arr, obj } from "./project.js";
import { ACTION_TYPES } from "./validator.js";

const KIND_NAMES = { dialogue: "대화", event: "이벤트씬", radio: "무전" };
const COL_W = 210, ROW_H = 92, NODE_W = 180, NODE_H = 64;

// 시작 줄부터 단계(열)별 순서
function order(d) {
	const nodes = obj(d.nodes);
	const depth = {};
	const queue = [String(d.start ?? "")];
	for (const r of arr(d.start_if)) queue.push(String(obj(r).start ?? ""));
	for (const q of queue) depth[q] = 0;
	const seq = [];
	while (queue.length) {
		const cur = queue.shift();
		if (!(cur in nodes) || seq.includes(cur)) continue;
		seq.push(cur);
		const n = obj(nodes[cur]);
		const outs = [];
		if (n.next !== null && n.next !== undefined && String(n.next) !== "") outs.push(String(n.next));
		for (const c of arr(n.choices)) outs.push(String(obj(c).next ?? ""));
		for (const o of outs) if (!(o in depth)) { depth[o] = depth[cur] + 1; queue.push(o); }
	}
	let maxD = Math.max(0, ...Object.values(depth));
	for (const nid of Object.keys(nodes)) if (!seq.includes(nid)) { seq.push(nid); depth[nid] = ++maxD; }
	return { seq, depth };
}

export function renderDialogue(p, did, api) {
	const d = p.get("dialogue", did);
	const touched = () => { p.touch("dialogue", did); api.changed(); };
	const box = h("div", { class: "dlg" });
	const users = p.dialogueUsers(did);
	box.append(h("div", { class: "hint block" }, `쓰는 곳: ${users.length ? users.join(", ") : "없음 (어디서도 안 부름)"}`));

	// 대화 정보
	const head = {};
	for (const k of ["kind", "start", "start_if"]) if (d[k] !== undefined) head[k] = d[k];
	const headForm = fieldForm(head, [
		{ key: "kind", label: "종류", type: "enum", options: ["dialogue", "event", "radio"], labels: { dialogue: "dialogue (대화)", event: "event (이벤트씬)", radio: "radio (무전)" } },
		{ key: "start", label: "시작 줄", type: "enum", options: Object.keys(obj(d.nodes)) },
		{ key: "start_if", label: "조건별 시작 줄", type: "json", rows: 3, hint: "[{flag, start}] 위에서부터" },
	], () => {
		for (const k of ["kind", "start", "start_if"]) { if (k in head) d[k] = head[k]; else delete d[k]; }
		touched();
	});
	headForm.querySelector("details.extra").remove();
	box.append(headForm);

	// 그래프
	const { seq, depth } = order(d);
	box.append(graph(p, d, seq, depth));

	// 줄 카드
	const cards = h("div", { class: "cards" });
	for (const nid of seq) cards.append(card(p, d, did, nid, touched, api));
	box.append(cards);
	box.append(h("div", { class: "row wrap" },
		h("button", { class: "btn", onclick: () => { addNode(d, null); touched(); api.render(); } }, "+ 줄 추가 (맨 끝)"),
		h("button", { class: "btn", onclick: () => playthrough(p, d) }, "▶ 미리 읽기")));
	return box;
}

function graph(p, d, seq, depth) {
	const nodes = obj(d.nodes);
	const rows = {};
	const pos = {};
	for (const nid of seq) {
		const col = depth[nid] || 0;
		const row = rows[col] || 0;
		rows[col] = row + 1;
		pos[nid] = [col * COL_W + 10, row * ROW_H + 10];
	}
	const w = Math.max(...Object.values(pos).map((q) => q[0])) + NODE_W + 20;
	const hh = Math.max(...Object.values(pos).map((q) => q[1])) + NODE_H + 20;
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("width", w);
	svg.setAttribute("height", hh);
	svg.setAttribute("class", "graph");
	const el = (tag, attrs, text) => {
		const e = document.createElementNS(ns, tag);
		for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
		if (text !== undefined) e.textContent = text;
		svg.append(e);
		return e;
	};
	const defs = el("defs", {});
	const marker = document.createElementNS(ns, "marker");
	for (const [k, v] of Object.entries({ id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" })) marker.setAttribute(k, v);
	const path = document.createElementNS(ns, "path");
	path.setAttribute("d", "M0,0 L10,5 L0,10 z");
	path.setAttribute("class", "arrowhead");
	marker.append(path);
	defs.append(marker);
	const link = (a, b, choice) => {
		if (!pos[a] || !pos[b]) return;
		const [x1, y1] = [pos[a][0] + NODE_W, pos[a][1] + NODE_H / 2];
		const [x2, y2] = [pos[b][0], pos[b][1] + NODE_H / 2];
		const back = x2 <= x1;
		const dpath = back ? `M${x1},${y1} C${x1 + 40},${y1 + 70} ${x2 - 40},${y2 + 70} ${x2},${y2}` : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
		el("path", { d: dpath, class: "edge" + (choice ? " choice" : ""), "marker-end": "url(#arrow)" });
	};
	for (const nid of seq) {
		const n = obj(nodes[nid]);
		const ch = arr(n.choices);
		if (ch.length) for (const c of ch) link(nid, String(obj(c).next ?? ""), true);
		else if (n.next) link(nid, String(n.next), false);
	}
	for (const nid of seq) {
		const n = obj(nodes[nid]);
		const [x, y] = pos[nid];
		const g = el("g", { class: "gnode" + (nid === String(d.start) ? " start" : ""), transform: `translate(${x},${y})`, tabindex: 0 });
		const rect = document.createElementNS(ns, "rect");
		for (const [k, v] of Object.entries({ width: NODE_W, height: NODE_H, rx: 8 })) rect.setAttribute(k, v);
		g.append(rect);
		const t1 = document.createElementNS(ns, "text");
		t1.setAttribute("x", 8);
		t1.setAttribute("y", 18);
		t1.setAttribute("class", "gt1");
		t1.textContent = `${nid === String(d.start) ? "▶ " : ""}${nid} · ${p.characterName(n.speaker)}`.slice(0, 26);
		g.append(t1);
		const text = String(n.text ?? "");
		[text.slice(0, 15), text.slice(15, 30) + (text.length > 30 ? "…" : "")].forEach((line, i) => {
			const t = document.createElementNS(ns, "text");
			t.setAttribute("x", 8);
			t.setAttribute("y", 38 + i * 16);
			t.setAttribute("class", "gt2");
			t.textContent = line;
			g.append(t);
		});
		g.addEventListener("click", () => {
			const c = document.getElementById("card-" + nid);
			if (c) {
				c.scrollIntoView({ behavior: "smooth", block: "start" });
				c.classList.add("flash");
				setTimeout(() => c.classList.remove("flash"), 900);
			}
		});
	}
	return h("details", { class: "graph-wrap", open: seq.length <= 14 }, h("summary", {}, `흐름 그래프 (줄 ${seq.length}) — 줄을 누르면 아래 카드로`), h("div", { class: "graph-scroll" }, svg));
}

function card(p, d, did, nid, touched, api) {
	const nodes = obj(d.nodes);
	const n = nodes[nid];
	const ids = Object.keys(nodes);
	const isStart = nid === String(d.start);
	const sp = String(n.speaker ?? "");
	const chars = Object.keys(p.characters);
	const c = h("div", { class: "ncard" + (isStart ? " start" : ""), id: "card-" + nid });
	const speaker = h("select", { class: "input" }, h("option", { value: "", selected: !sp }, "(나레이션)"),
		chars.map((id) => h("option", { value: id, selected: id === sp }, `${p.characterName(id)} (${id})`)),
		sp && !chars.includes(sp) ? h("option", { value: sp, selected: true }, sp + " ⚠ 없는 인물") : null);
	speaker.addEventListener("change", () => { n.speaker = speaker.value; touched(); api.render(); });
	const text = h("textarea", { class: "input", rows: 3 });
	text.value = String(n.text ?? "");
	text.addEventListener("input", () => { n.text = text.value; touched(); });
	const exprs = arr(obj(p.characters[sp]).expressions);
	const extraRow = [];
	if (exprs.length) {
		const ex = h("select", { class: "input" }, h("option", { value: "" }, "(표정 없음)"), exprs.map((e) => h("option", { value: e, selected: e === n.expression }, e)));
		ex.addEventListener("change", () => { if (ex.value) n.expression = ex.value; else delete n.expression; touched(); });
		extraRow.push(h("label", { class: "mini" }, "표정", ex));
	}
	const side = h("select", { class: "input" }, ["", "left", "right"].map((s) => h("option", { value: s, selected: (n.side ?? "") === s }, s || "(위치 없음)")));
	side.addEventListener("change", () => { if (side.value) n.side = side.value; else delete n.side; touched(); });
	extraRow.push(h("label", { class: "mini" }, "위치", side));

	const choices = arr(n.choices);
	const flow = h("div", { class: "flow-box" });
	const nextSel = (val, onPick) => {
		const s = h("select", { class: "input" }, h("option", { value: "", selected: !val }, "(끝)"),
			ids.map((x) => h("option", { value: x, selected: x === val }, x + " · " + String(obj(nodes[x]).text ?? "").slice(0, 14))));
		s.addEventListener("change", () => onPick(s.value));
		return s;
	};
	if (!choices.length) {
		flow.append(h("label", { class: "mini" }, "다음 줄", nextSel(n.next ? String(n.next) : "", (v) => { n.next = v || null; touched(); api.render(); })));
	} else {
		choices.forEach((ch, i) => {
			const t = h("input", { class: "input", value: ch.text ?? "", placeholder: "선택지 글" });
			t.addEventListener("input", () => { ch.text = t.value; touched(); });
			const flag = h("input", { class: "input small-w", value: ch.if_flag ?? "", placeholder: "보일 조건 플래그" });
			flag.addEventListener("input", () => { if (flag.value) ch.if_flag = flag.value; else delete ch.if_flag; touched(); });
			flow.append(h("div", { class: "choice" }, h("span", { class: "cno" }, "◇" + (i + 1)), t,
				nextSel(String(ch.next ?? ""), (v) => { ch.next = v; touched(); api.render(); }), flag,
				h("button", { class: "btn small danger", onclick: () => { choices.splice(i, 1); if (!choices.length) { delete n.choices; n.next = null; } touched(); api.render(); } }, "✕")));
		});
	}
	const addChoice = h("button", { class: "btn small", onclick: () => {
		const chs = arr(n.choices);
		if (!chs.length && n.next) chs.push({ text: "선택지", next: String(n.next) });
		chs.push({ text: "선택지", next: "" });
		n.choices = chs;
		delete n.next;
		touched();
		api.render();
	} }, "+ 선택지");

	// 플래그·행동
	const fx = {};
	for (const k of ["set_flags", "actions"]) if (n[k] !== undefined) fx[k] = n[k];
	const rest = {};
	for (const k of Object.keys(n)) if (!["speaker", "text", "expression", "side", "next", "choices", "set_flags", "actions"].includes(k)) rest[k] = n[k];
	const fxForm = fieldForm(Object.assign(fx, rest), [
		{ key: "set_flags", label: "켤 플래그", type: "json", rows: 2, hint: '{"이름": true}' },
		{ key: "actions", label: "행동", type: "json", rows: 3, hint: `[{"type": "objective", "id": "목표ID"}] · 종류: ${ACTION_TYPES.join(", ")}` },
	], () => {
		for (const k of Object.keys(n)) if (!["speaker", "text", "expression", "side", "next", "choices"].includes(k)) delete n[k];
		Object.assign(n, fx);
		touched();
	});
	fxForm.querySelector("details.extra summary").textContent = "연출·기타 키 (bg, bgm, sfx, shake, cutin, wait …)";
	const summary = [];
	if (Object.keys(obj(n.set_flags)).length) summary.push("플래그 " + Object.keys(n.set_flags).join(", "));
	for (const a of arr(n.actions)) summary.push(`▸ ${obj(a).type} ${obj(a).id ?? ""}`);

	c.append(
		h("div", { class: "ncard-head" },
			h("b", {}, (isStart ? "▶ " : "") + nid),
			h("span", { class: "who" }, p.characterName(sp)),
			h("span", { class: "spacer" }),
			!isStart ? h("button", { class: "btn small", onclick: () => { d.start = nid; touched(); api.render(); } }, "시작 줄로") : null,
			h("button", { class: "btn small", onclick: () => { addNode(d, nid); touched(); api.render(); } }, "+ 다음 줄"),
			h("button", { class: "btn small danger", onclick: async () => { if (await removeNode(d, nid, api)) { touched(); api.render(); } } }, "✕")),
		h("div", { class: "row" }, h("label", { class: "mini grow" }, "말하는 사람", speaker), ...extraRow),
		text,
		flow,
		h("div", { class: "row" }, addChoice, summary.length ? h("span", { class: "fxsum" }, summary.join(" · ")) : null),
		h("details", { class: "fx" }, h("summary", {}, "플래그·행동·연출"), fxForm));
	return c;
}

function newId(nodes) {
	let i = Object.keys(nodes).length + 1;
	while (("n" + i) in nodes) i++;
	return "n" + i;
}

// after 다음에 새 줄을 끼움 (after 의 다음 줄을 새 줄이 이어받음). after 가 없으면 끝에 따로
export function addNode(d, after) {
	const nodes = d.nodes || (d.nodes = {});
	const nid = newId(nodes);
	const node = { speaker: "", text: "", next: null };
	if (after && nodes[after]) {
		const prev = nodes[after];
		node.speaker = prev.speaker ?? "";
		if (!arr(prev.choices).length) {
			node.next = prev.next ?? null;
			prev.next = nid;
		}
	}
	nodes[nid] = node;
	return nid;
}

async function removeNode(d, nid, api) {
	const nodes = obj(d.nodes);
	if (String(d.start) === nid) {
		api.toast("시작 줄은 지울 수 없음 — 다른 줄을 시작 줄로 먼저", true);
		return false;
	}
	if (!(await confirmBox(`줄 ${nid} 를 지울까요? (이 줄로 오던 연결은 다음 줄로 이어짐)`, "지우기"))) return false;
	const nxt = nodes[nid].next ?? null;
	delete nodes[nid];
	if (d._editor && d._editor.pos) delete d._editor.pos[nid];
	for (const o of Object.values(nodes)) {
		if (String(o.next ?? "") === nid) o.next = nxt;
		for (const c of arr(o.choices)) if (String(c.next ?? "") === nid) c.next = nxt === null ? "" : String(nxt);
	}
	return true;
}

// 첫 선택지를 따라 끝까지 읽기
function playthrough(p, d) {
	const nodes = obj(d.nodes);
	const lines = [];
	let nid = String(d.start ?? "");
	let guard = 0;
	while (nid in nodes && guard++ < 80) {
		const n = obj(nodes[nid]);
		lines.push(h("p", {}, n.speaker ? h("b", {}, p.characterName(n.speaker) + ": ") : h("i", {}, "(나레이션) "), String(n.text ?? "")));
		const ch = arr(n.choices);
		if (ch.length) {
			lines.push(h("p", { class: "hint" }, "선택: " + ch.map((c) => obj(c).text).join(" / ")));
			nid = String(obj(ch[0]).next ?? "");
		} else nid = n.next ? String(n.next) : "";
	}
	const dlg = h("dialog", { class: "modal wide" }, h("h3", {}, `${KIND_NAMES[d.kind] || d.kind} 미리 읽기`), h("div", { class: "read" }, lines),
		h("div", { class: "row end" }, h("button", { class: "btn primary", onclick: () => { dlg.close(); dlg.remove(); } }, "닫기")));
	document.body.append(dlg);
	dlg.showModal();
}
