// story-data/1 점검과 대본(흐름). core/story_validator.gd 를 그대로 옮긴 것 — 규칙을 바꾸면 두 곳을 같이 고친다.
import { arr, obj, isObj } from "./project.js";

const OBJECTIVE_KEYS = {
	talk: [], event: ["event"], reach: [], defeat_group: ["group"], defeat_boss: ["group"],
	defeat_count: ["group", "count"], defend: ["target", "seconds"], escort: ["target", "to"],
	destroy: ["group"], collect: ["group", "count"], flag: ["flag"],
};
export const OBJECTIVE_TYPES = Object.keys(OBJECTIVE_KEYS);
export const ACTION_TYPES = ["objective", "quest_start", "quest_advance", "quest_complete", "heal_player", "effect", "unlock_region", "give", "bond", "pilot"];
const RADIO_ON = ["start", "objective_start", "objective_done", "player_hp_below", "boss_hp_below", "time"];
const S = (v) => (v === undefined || v === null ? "" : String(v));

export class StoryValidator {
	constructor(p) {
		this.p = p;
		this.issues = [];
	}
	errorCount() {
		return this.issues.filter((i) => i.level === "error").length;
	}
	warnCount() {
		return this.issues.length - this.errorCount();
	}

	check() {
		const p = this.p;
		this.issues = [];
		this.setFlags = new Map();
		this.readFlags = new Map();
		this.completes = new Set();
		for (const e of p.loadErrors) this.add("error", "data", "", e);
		this.collectAutoFlags();
		for (const id of p.ids("dialogue")) this.checkDialogue(id, p.items.dialogue[id]);
		for (const id of p.ids("mission")) this.checkMission(id, p.items.mission[id]);
		for (const id of p.chapterOrder()) this.checkChapter(id, p.items.chapter[id]);
		for (const f of [...this.readFlags.keys()].sort()) {
			if (!this.setFlags.has(f)) {
				const r = this.readFlags.get(f);
				this.add("warn", r.kind, r.id, `플래그 '${f}' 를 켜는 곳이 없음`);
			}
		}
		return this.issues;
	}

	collectAutoFlags() {
		const p = this.p;
		for (const pattern of arr(p.runtime("auto_flags", []))) {
			const pat = S(pattern);
			let expanded = [pat];
			for (const token of ["dialogue", "mission", "sub", "main"]) {
				if (!pat.includes(`{${token}}`)) continue;
				const source = token === "dialogue" ? p.ids("dialogue")
					: p.ids("mission").filter((m) => token === "mission" || S(p.items.mission[m].kind) === token);
				const next = [];
				for (const e of expanded) for (const id of source) next.push(e.replaceAll(`{${token}}`, id));
				expanded = next;
			}
			for (const e of expanded) {
				if (e.includes("{step}")) {
					for (const mid of p.ids("mission")) {
						if (e.includes("." + mid + ".")) {
							for (const o of arr(p.items.mission[mid].objectives)) this.setFlags.set(e.replaceAll("{step}", S(obj(o).id)), "게임");
						}
					}
				} else this.setFlags.set(e, "게임");
			}
		}
	}

	checkDialogue(id, d) {
		const p = this.p;
		const kind = S(d.kind);
		if (!["dialogue", "event", "radio"].includes(kind)) this.add("error", "dialogue", id, `kind 는 dialogue/event/radio (지금 '${kind}')`);
		else if (!arr(p.runtime("dialogue_kinds", ["dialogue", "event", "radio"])).includes(kind)) this.add("warn", "dialogue", id, `이 게임은 아직 kind '${kind}' 를 실행하지 못함`);
		const nodes = obj(d.nodes);
		if (Object.keys(nodes).length === 0) {
			this.add("error", "dialogue", id, "노드가 없음");
			return;
		}
		const roots = [S(d.start)];
		if (!(roots[0] in nodes)) this.add("error", "dialogue", id, `start 노드 없음: ${roots[0]}`);
		for (const rule of arr(d.start_if)) {
			this.flagRead(S(obj(rule).flag), "dialogue", id);
			roots.push(S(obj(rule).start));
			if (!(roots[roots.length - 1] in nodes)) this.add("error", "dialogue", id, `start_if 노드 없음: ${roots[roots.length - 1]}`);
		}
		for (const [nid, n0] of Object.entries(nodes)) {
			const n = obj(n0);
			const sp = S(n.speaker);
			if (sp && !(sp in p.characters)) this.add("error", "dialogue", id, `${nid}: 없는 인물 '${sp}' (characters.json)`);
			else if (sp && n.expression !== undefined) {
				const ex = arr(obj(p.characters[sp]).expressions);
				if (ex.length && !ex.includes(S(n.expression))) this.add("warn", "dialogue", id, `${nid}: ${sp} 에게 없는 표정 ${n.expression}`);
			}
			if (S(n.text).includes("[테스트]")) this.add("warn", "dialogue", id, `${nid}: [테스트] 임시 문구`);
			if (n.next !== null && n.next !== undefined && S(n.next) !== "" && !(S(n.next) in nodes)) this.add("error", "dialogue", id, `${nid} → 없는 노드 ${n.next}`);
			if (n.cutin !== undefined && !(S(obj(n.cutin).character) in p.characters)) this.add("error", "dialogue", id, `${nid}: 컷인 인물 없음`);
			for (const f of Object.keys(obj(n.set_flags))) this.flagSet(f);
			const choices = arr(n.choices);
			if (kind === "radio" && choices.length) this.add("warn", "dialogue", id, `${nid}: 무전에는 선택지를 쓰지 않음`);
			for (const c0 of choices) {
				const c = obj(c0);
				if (!(S(c.next) in nodes)) this.add("error", "dialogue", id, `${nid} 선택지 '${S(c.text)}' → 없는 노드 ${S(c.next)}`);
				for (const f of Object.keys(obj(c.set_flags))) this.flagSet(f);
				if (S(c.if_flag)) this.flagRead(S(c.if_flag), "dialogue", id);
			}
			for (const a of arr(n.actions)) this.checkAction(id, nid, a);
		}
		const seen = new Set();
		const stack = roots.slice();
		while (stack.length) {
			const cur = S(stack.pop());
			if (seen.has(cur) || !(cur in nodes)) continue;
			seen.add(cur);
			const nn = obj(nodes[cur]);
			if (nn.next !== null && nn.next !== undefined && S(nn.next)) stack.push(S(nn.next));
			for (const c of arr(nn.choices)) stack.push(S(obj(c).next));
		}
		for (const nid of Object.keys(nodes)) if (!seen.has(nid)) this.add("warn", "dialogue", id, `도달할 수 없는 노드: ${nid}`);
	}

	checkAction(did, nid, a) {
		const p = this.p;
		if (!isObj(a)) {
			this.add("error", "dialogue", did, `${nid}: action 형식 오류`);
			return;
		}
		const t = S(a.type);
		if (!ACTION_TYPES.includes(t)) {
			this.add("error", "dialogue", did, `${nid}: 모르는 action '${t}'`);
			return;
		}
		if (!arr(p.runtime("action_types", ACTION_TYPES)).includes(t)) this.add("warn", "dialogue", did, `${nid}: 이 게임은 아직 action '${t}' 를 실행하지 못함`);
		if (t === "objective") this.completes.add(S(a.id) + "@" + did);
		else if (t.startsWith("quest_")) {
			const m = p.get("mission", S(a.id));
			if (!m || S(m.kind) !== "sub") this.add("error", "dialogue", did, `${nid}: ${t} 대상 서브 미션 없음 ${S(a.id)}`);
		} else if (t === "unlock_region" && !(S(a.id) in p.regions)) this.add("error", "dialogue", did, `${nid}: 없는 지역 ${S(a.id)}`);
		else if (t === "bond" && !(S(a.character) in p.characters)) this.add("error", "dialogue", did, `${nid}: 없는 인물 ${S(a.character)}`);
	}

	checkMission(id, m) {
		const p = this.p;
		if (S(m.id) !== id) this.add("error", "mission", id, `id 가 파일 이름과 다름 (${S(m.id)})`);
		const kind = S(m.kind);
		if (!["main", "sub"].includes(kind)) this.add("error", "mission", id, "kind 는 main/sub");
		const chapter = S(m.chapter);
		if (chapter && !(chapter in p.items.chapter)) this.add("error", "mission", id, `없는 장 ${chapter}`);
		if (kind === "main" && !chapter) this.add("error", "mission", id, "메인 미션인데 장이 없음");
		const regions = p.regions;
		if (Object.keys(regions).length && S(m.region) && !(S(m.region) in regions)) this.add("error", "mission", id, `없는 지역 ${m.region}`);
		const map = S(m.map);
		if (!map) {
			if (kind === "main") this.add("warn", "mission", id, "맵(map)이 아직 없음");
		} else if (p.fileExists(map) === false) this.add("error", "mission", id, `맵 씬 없음 ${map}`);
		for (const key of ["briefing", "debrief"]) if (S(m[key])) this.needDialogue("mission", id, S(m[key]), key, ["dialogue"]);
		if (S(m.opening_event)) this.needDialogue("mission", id, S(m.opening_event), "opening_event", ["event"]);
		const req = obj(m.requires);
		for (const r of arr(req.missions)) if (!(S(r) in p.items.mission)) this.add("error", "mission", id, `requires 미션 없음 ${r}`);
		for (const f of arr(req.flags)) this.flagRead(S(f), "mission", id);
		if (S(req.chapter) && !(S(req.chapter) in p.items.chapter)) this.add("error", "mission", id, `requires 장 없음 ${req.chapter}`);
		const objIds = arr(m.objectives).map((o) => S(obj(o).id));
		const spawns = obj(m.spawns);
		const groups = new Set();
		const npcDialogues = [];
		const npcNodes = new Set();
		for (const n0 of arr(spawns.npcs)) {
			const n = obj(n0);
			const ch = S(n.character);
			if (!(ch in p.characters)) this.add("error", "mission", id, `NPC 인물 없음 '${ch}'`);
			const dlg = S(n.dialogue);
			npcDialogues.push(dlg);
			npcNodes.add("NPCs/" + S(n.node !== undefined ? n.node : "Npc_" + dlg));
			this.needDialogue("mission", id, dlg, `NPC ${ch}`, ["dialogue"]);
			this.checkPosition("mission", id, n, "NPC " + ch);
		}
		for (const e0 of arr(spawns.enemies)) {
			const e = obj(e0);
			groups.add(S(e.group));
			const en = S(e.enemy);
			if (!en && !S(e.scene)) this.add("error", "mission", id, `적 배치에 enemy(또는 scene) 가 없음 (${S(e.group)})`);
			else if (en && !(en in p.enemies)) this.add("error", "mission", id, `없는 적 종류 '${en}' (enemies.json)`);
			if (S(e.appear_with) && !objIds.includes(S(e.appear_with))) this.add("error", "mission", id, `적 appear_with 목표 없음 ${e.appear_with}`);
			this.checkPosition("mission", id, e, "적 " + S(e.group));
		}
		const allowed = arr(p.runtime("objective_types", OBJECTIVE_TYPES));
		const seenIds = new Set();
		for (const o0 of arr(m.objectives)) {
			const o = obj(o0);
			const oid = S(o.id);
			const t = S(o.type);
			if (seenIds.has(oid)) this.add("error", "mission", id, `목표 id 중복 ${oid}`);
			seenIds.add(oid);
			if (!(t in OBJECTIVE_KEYS)) {
				this.add("error", "mission", id, `${oid}: 모르는 목표 type '${t}'`);
				continue;
			}
			if (!allowed.includes(t)) this.add("warn", "mission", id, `${oid}: 이 게임은 아직 목표 '${t}' 를 실행하지 못함`);
			for (const key of OBJECTIVE_KEYS[t]) if (o[key] === undefined) this.add("error", "mission", id, `${oid}: ${t} 목표에 '${key}' 가 없음`);
			if (t === "reach" && o.pos === undefined && o.at === undefined) this.add("error", "mission", id, `${oid}: reach 목표에 pos/at 이 없음`);
			if (o.group !== undefined && !groups.has(S(o.group))) this.add(t === "defeat_count" ? "warn" : "error", "mission", id, `${oid}: 무리 '${o.group}' 가 이 미션 spawns 에 없음`);
			if (S(o.event)) this.needDialogue("mission", id, S(o.event), "목표 " + oid, ["event"]);
			if (t === "event" && !this.completes.has(oid + "@" + S(o.event))) this.add("error", "mission", id, `${oid}: 이벤트 ${S(o.event)} 에 이 목표를 끝내는 action objective 가 없음`);
			if (t === "talk") {
				const by = S(o.dialogue) ? [S(o.dialogue)] : npcDialogues;
				let ok = kind === "sub" && !!S(o.dialogue);
				for (const dlg of by) if (this.completes.has(oid + "@" + dlg)) ok = true;
				if (S(o.dialogue)) this.needDialogue("mission", id, S(o.dialogue), "목표 " + oid, ["dialogue"]);
				if (!ok) this.add("error", "mission", id, `${oid}: 이 목표를 끝내는 대화(action objective)가 없음`);
			}
			const marker = obj(o.marker);
			if (marker.node !== undefined && !npcNodes.has(S(marker.node))) this.add("warn", "mission", id, `${oid}: marker 노드 ${marker.node} 가 이 미션 NPC 에 없음 (맵에 있어야 함)`);
			for (const f of Object.keys(obj(o.set_flags))) this.flagSet(f);
			if (t === "flag") this.flagRead(S(o.flag), "mission", id);
		}
		for (const r0 of arr(m.radio)) {
			const r = obj(r0);
			const on = S(r.on);
			if (!RADIO_ON.includes(on)) this.add("error", "mission", id, `무전 조건 모름 '${on}'`);
			if ((on === "objective_start" || on === "objective_done") && !objIds.includes(S(r.id))) this.add("error", "mission", id, `무전 ${on}: 목표 없음 ${S(r.id)}`);
			if (on === "boss_hp_below" && !groups.has(S(r.id))) this.add("error", "mission", id, `무전 boss_hp_below: 무리 없음 ${S(r.id)}`);
			this.needDialogue("mission", id, S(r.dialogue), "무전", ["radio"]);
		}
		const rw = obj(m.rewards);
		for (const f of Object.keys(obj(rw.flags))) this.flagSet(f);
		for (const reg of arr(rw.unlock_regions)) if (!(S(reg) in regions)) this.add("error", "mission", id, `보상 지역 없음 ${reg}`);
	}

	checkPosition(kind, id, e, label) {
		const mode = S(this.p.runtime("position", "pos"));
		if (e.pos === undefined && e.at === undefined) this.add("error", kind, id, `${label}: 위치(pos/at)가 없음`);
		else if (e[mode] === undefined) this.add("warn", kind, id, `${label}: 이 게임은 위치를 '${mode}' 로 씀`);
	}

	checkChapter(id, c) {
		const p = this.p;
		if (S(c.id) !== id) this.add("error", "chapter", id, "id 가 파일 이름과 다름");
		const status = S(c.status);
		if (!["playable", "outline"].includes(status)) this.add("error", "chapter", id, "status 는 playable/outline");
		if (S(c.next) && !(S(c.next) in p.items.chapter)) this.add("error", "chapter", id, `next 장 없음 ${c.next}`);
		for (const key of ["opening_event", "ending_event"]) if (S(c[key])) this.needDialogue("chapter", id, S(c[key]), key, ["event"]);
		const mains = arr(c.missions);
		const limit = Number(p.runtime("main_missions_per_chapter", 0)) || 0;
		if (limit > 0 && mains.length > limit) this.add("error", "chapter", id, `이 게임은 장마다 메인 미션 ${limit}개까지 (지금 ${mains.length}개)`);
		if (status === "playable" && !mains.length) this.add("error", "chapter", id, "playable 인데 메인 미션이 없음");
		if (status === "outline" && !arr(c.planned).length && !S(c.synopsis)) this.add("warn", "chapter", id, "outline 인데 줄거리·예정 사건이 비어 있음");
		const done = [];
		for (const mid0 of mains) {
			const mid = S(mid0);
			const m = p.get("mission", mid);
			if (!m) {
				this.add("error", "chapter", id, `메인 미션 없음 ${mid}`);
				continue;
			}
			if (S(m.chapter) !== id || S(m.kind) !== "main") this.add("error", "chapter", id, `${mid} 가 이 장의 메인 미션이 아님`);
			for (const r of arr(obj(m.requires).missions)) {
				const rm = p.get("mission", S(r));
				if (rm && S(rm.chapter) === id && !done.includes(S(r))) this.add("error", "chapter", id, `${mid} 가 아직 순서가 안 된 ${r} 를 요구함`);
			}
			done.push(mid);
		}
		for (const mid of arr(c.sub_missions)) {
			const m = p.get("mission", S(mid));
			if (!m || S(m.kind) !== "sub") this.add("error", "chapter", id, `서브 미션 없음(또는 kind 가 sub 아님) ${mid}`);
		}
		for (const be0 of arr(c.base_events)) {
			const be = obj(be0);
			if (!done.includes(S(be.after))) this.add("error", "chapter", id, `거점 이벤트 ${S(be.id)}: after 가 이 장 메인 미션이 아님`);
			if (S(be.dialogue)) this.needDialogue("chapter", id, S(be.dialogue), "거점 이벤트", ["dialogue", "event"]);
		}
	}

	needDialogue(kind, id, did, label, kinds) {
		const d = this.p.get("dialogue", did);
		if (!did || !d) this.add("error", kind, id, `${label}: 대화 없음 '${did}'`);
		else if (!kinds.includes(S(d.kind))) this.add("error", kind, id, `${label}: ${did} 는 kind ${kinds.join("/")} 여야 함 (지금 ${S(d.kind)})`);
	}
	flagSet(f) {
		this.setFlags.set(f, true);
	}
	flagRead(f, kind, id) {
		if (f && !this.readFlags.has(f)) this.readFlags.set(f, { kind, id });
	}
	add(level, kind, id, msg) {
		this.issues.push({ level, kind, id, msg });
	}

	// ── 대본 ──
	flowText(cid) {
		const p = this.p;
		const c = p.get("chapter", cid) || {};
		const out = [];
		out.push(`■ ${S(c.title) || cid}  [${S(c.status)}]`);
		if (S(c.synopsis)) out.push("  " + c.synopsis);
		for (const pl of arr(c.planned)) out.push("  - " + pl);
		this.talkLines(out, "장 시작", S(c.opening_event));
		for (const mid of arr(c.missions)) {
			this.missionLines(out, S(mid));
			for (const be of arr(c.base_events)) {
				if (S(obj(be).after) === S(mid)) {
					out.push(`\n  ◆ 거점 이벤트 ${S(be.id)}  개방 [${arr(be.unlocks).map((u) => JSON.stringify(String(u))).join(", ")}]`);
					this.talkLines(out, "거점", S(be.dialogue));
				}
			}
		}
		for (const mid of arr(c.sub_missions)) this.missionLines(out, S(mid));
		this.talkLines(out, "장 끝", S(c.ending_event));
		if (S(c.next)) out.push(`\n→ 다음 장 ${c.next}`);
		return out.join("\n");
	}
	missionLines(out, mid) {
		const p = this.p;
		const m = p.get("mission", mid);
		if (!m) return;
		out.push(`\n▶ [${S(m.kind)}] ${mid} 「${S(m.title)}」 ${S(m.map).split("/").pop()}`);
		if (S(m.summary)) out.push("   " + m.summary);
		for (const n of arr(obj(m.spawns).npcs)) out.push(`   인물: ${p.characterName(S(obj(n).character))} (${S(obj(n).dialogue)})`);
		this.talkLines(out, "브리핑", S(m.briefing));
		this.talkLines(out, "시작 이벤트", S(m.opening_event));
		arr(m.objectives).forEach((o0, i) => {
			const o = obj(o0);
			out.push(`   ${i + 1}. [${S(o.type)}] ${S(o.text)}${o.optional ? "  (보너스)" : ""}`);
			if (o.weather !== undefined) out.push(`      날씨 → ${o.weather}`);
			for (const e of arr(obj(m.spawns).enemies)) {
				if (S(obj(e).appear_with) === S(o.id)) {
					const en = S(e.enemy);
					out.push(`      등장: ${S(obj(p.enemies[en]).name) || en} ×${Number(e.count || 1)}`);
				}
			}
			this.talkLines(out, "이벤트", S(o.event));
		});
		for (const r of arr(m.radio)) this.talkLines(out, `무전 ${S(obj(r).on)} ${S(r.id !== undefined ? r.id : r.value)}`, S(r.dialogue));
		this.talkLines(out, "후일담", S(m.debrief));
	}
	talkLines(out, label, did) {
		const d = this.p.get("dialogue", did);
		if (!did || !d) return;
		out.push(`     〔${label}: ${did}〕`);
		const nodes = obj(d.nodes);
		let nid = S(d.start);
		let guard = 0;
		while (nid in nodes && guard++ < 80) {
			const n = obj(nodes[nid]);
			const sp = S(n.speaker);
			out.push(`       ${sp ? this.p.characterName(sp) + ": " : "(나레이션) "}${S(n.text)}`);
			const ch = arr(n.choices);
			if (ch.length) {
				out.push("         선택: " + ch.map((c) => S(obj(c).text)).join(" / "));
				nid = S(obj(ch[0]).next);
			} else nid = n.next === null || n.next === undefined ? "" : S(n.next);
		}
	}
}

export function issueText(i) {
	const names = { chapter: "장", mission: "미션", dialogue: "대화", data: "데이터" };
	return `[${i.level === "error" ? "오류" : "경고"}] ${names[i.kind] || i.kind} ${i.id}: ${i.msg}`;
}
