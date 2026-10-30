// 게임 저장소 하나의 스토리 데이터(story-data/1). core/story_project.gd 의 웹 버전.
// 파일 내용(text)을 받아 항목으로 나누고, 고친 항목을 다시 글로 만들어 바뀐 파일만 골라 준다.
import { parse, stringify } from "./storyjson.js";

export const PROFILE_PATH = "data/story/project.json";
export const SINGLE_FILES = {
	characters: "data/story/characters.json",
	regions: "data/story/regions.json",
	enemies: "data/story/enemies.json",
};
export const DIRS = {
	chapter: "data/story/chapters/",
	mission: "data/missions/",
	dialogue: "data/dialogue/",
};
export const KIND_NAMES = { chapter: "장", mission: "미션", dialogue: "대화" };

// 이 경로의 파일이 스토리 데이터인가 (불러올 대상)
export function isStoryPath(path) {
	if (path === PROFILE_PATH || Object.values(SINGLE_FILES).includes(path)) return true;
	return Object.values(DIRS).some((d) => path.startsWith(d) && path.endsWith(".json") && !path.slice(d.length).includes("/"));
}

export class StoryProject {
	// files: { path: text } — 원본. allPaths: 저장소의 모든 파일 경로(맵 존재 확인용, 모르면 null)
	constructor(files, allPaths = null) {
		this.original = { ...files };
		this.allPaths = allPaths ? new Set(allPaths) : null;
		this.loadErrors = [];
		this.profile = {};
		this.single = { characters: {}, regions: {}, enemies: {} };
		this.items = { chapter: {}, mission: {}, dialogue: {} };
		this.docs = {};        // 경로 → 글 (문서)
		this.deleted = new Set();
		this.dirtyPaths = new Set();
		this._load(files);
	}

	_load(files) {
		const pr = files[PROFILE_PATH] !== undefined ? parse(files[PROFILE_PATH]) : { data: null, error: "파일 없음" };
		if (pr.error || !isObj(pr.data)) {
			this.loadErrors.push(`${PROFILE_PATH}: ${pr.error || "객체가 아님"} — story-data/1 프로젝트가 아님`);
		} else {
			this.profile = pr.data;
			if (this.profile.format !== "story-data/1") this.loadErrors.push(`${PROFILE_PATH}: format 이 story-data/1 이 아님`);
		}
		for (const [key, path] of Object.entries(SINGLE_FILES)) {
			if (files[path] === undefined) {
				if (key === "characters") this.loadErrors.push(`${path}: 파일 없음`);
				continue;
			}
			const r = parse(files[path]);
			if (r.error || !isObj(r.data)) this.loadErrors.push(`${path}: ${r.error || "객체가 아님"}`);
			else this.single[key] = r.data;
		}
		for (const [kind, dir] of Object.entries(DIRS)) {
			for (const path of Object.keys(files).sort()) {
				if (!path.startsWith(dir) || !path.endsWith(".json") || path.slice(dir.length).includes("/")) continue;
				const r = parse(files[path]);
				if (r.error || !isObj(r.data)) {
					this.loadErrors.push(`${path}: ${r.error || "객체가 아님"}`);
					continue;
				}
				this.items[kind][path.slice(dir.length, -5)] = r.data;
			}
		}
		for (const d of this.docPaths()) {
			if (files[d] !== undefined) this.docs[d] = files[d];
		}
	}

	// ── 조회 ──
	get characters() {
		if (!isObj(this.single.characters.characters)) this.single.characters.characters = {};
		return this.single.characters.characters;
	}
	get enemies() {
		return isObj(this.single.enemies.enemies) ? this.single.enemies.enemies : {};
	}
	get regions() {
		const out = {};
		for (const r of arr(this.single.regions.regions)) if (isObj(r)) out[String(r.id ?? "")] = r;
		return out;
	}
	title() {
		return String(this.profile.title || this.profile.game || "게임");
	}
	runtime(key, def) {
		const r = isObj(this.profile.runtime) ? this.profile.runtime : {};
		return r[key] !== undefined ? r[key] : def;
	}
	docPaths() {
		return arr(this.profile.docs).map(String);
	}
	ids(kind) {
		return Object.keys(this.items[kind]).sort();
	}
	get(kind, id) {
		return this.items[kind][id] || null;
	}
	chapterOrder() {
		return Object.keys(this.items.chapter).sort((a, b) => {
			const na = num(this.items.chapter[a].number, 9999), nb = num(this.items.chapter[b].number, 9999);
			return na !== nb ? na - nb : a < b ? -1 : 1;
		});
	}
	missionsOf(cid) {
		const c = this.get("chapter", cid) || {};
		const out = [];
		for (const key of ["missions", "sub_missions"]) for (const m of arr(c[key])) if (!out.includes(String(m))) out.push(String(m));
		for (const mid of this.ids("mission")) if (String(this.items.mission[mid].chapter ?? "") === cid && !out.includes(mid)) out.push(mid);
		return out;
	}
	looseMissions() {
		const used = new Set();
		for (const cid of Object.keys(this.items.chapter)) for (const m of this.missionsOf(cid)) used.add(m);
		return this.ids("mission").filter((m) => !used.has(m));
	}
	characterName(id) {
		if (!id) return "(나레이션)";
		const c = this.characters[id];
		return c && c.name ? String(c.name) : id;
	}
	fileExists(resPath) {
		if (!this.allPaths) return null;
		return this.allPaths.has(String(resPath).replace(/^res:\/\//, ""));
	}
	dialogueUsers(did) {
		const out = [];
		for (const mid of this.ids("mission")) {
			const m = this.items.mission[mid];
			for (const k of ["briefing", "debrief", "opening_event"]) if (m[k] === did) out.push(`미션 ${mid} ${k}`);
			for (const n of arr(obj(m.spawns).npcs)) if (isObj(n) && n.dialogue === did) out.push(`미션 ${mid} NPC ${this.characterName(n.character)}`);
			for (const o of arr(m.objectives)) if (isObj(o) && (o.event === did || o.dialogue === did)) out.push(`미션 ${mid} 목표 ${o.id}`);
			for (const r of arr(m.radio)) if (isObj(r) && r.dialogue === did) out.push(`미션 ${mid} 무전`);
		}
		for (const cid of this.ids("chapter")) {
			const c = this.items.chapter[cid];
			for (const k of ["opening_event", "ending_event"]) if (c[k] === did) out.push(`장 ${cid} ${k}`);
			for (const be of arr(c.base_events)) if (isObj(be) && be.dialogue === did) out.push(`장 ${cid} 거점 이벤트`);
		}
		return out;
	}

	// ── 수정 ──
	relPath(kind, id) {
		if (SINGLE_FILES[kind]) return SINGLE_FILES[kind];
		if (kind === "profile") return PROFILE_PATH;
		return DIRS[kind] + id + ".json";
	}
	touch(kind, id) {
		const p = this.relPath(kind, id);
		this.dirtyPaths.add(p);
		this.deleted.delete(p);
	}
	touchDoc(path) {
		this.dirtyPaths.add(path);
	}
	isValidId(id) {
		return /^[a-z0-9_.]+$/.test(id);
	}
	create(kind, id, extra = {}) {
		if (!this.isValidId(id)) return "ID 는 영문 소문자·숫자·밑줄·점만: " + id;
		if (this.items[kind][id]) return `이미 있는 ${KIND_NAMES[kind]}: ${id}`;
		let data;
		if (kind === "chapter") data = { id, number: Object.keys(this.items.chapter).length + 1, title: "새 장", status: "outline", synopsis: "", missions: [], sub_missions: [], planned: [] };
		else if (kind === "mission") data = { id, chapter: "", kind: "main", title: "새 미션", summary: "", map: "", requires: { missions: [], flags: [] }, spawns: { npcs: [], enemies: [] }, objectives: [], rewards: {} };
		else data = { kind: "dialogue", start: "n1", nodes: { n1: { speaker: "", text: "", next: null } } };
		Object.assign(data, extra);
		this.items[kind][id] = data;
		this.touch(kind, id);
		return "";
	}
	remove(kind, id) {
		delete this.items[kind][id];
		const p = this.relPath(kind, id);
		this.dirtyPaths.delete(p);
		if (this.original[p] !== undefined) this.deleted.add(p);
	}
	// 미션의 장·종류에 맞춰 장들의 missions / sub_missions 를 고침
	syncMembership(mid) {
		const m = this.get("mission", mid) || {};
		const want = String(m.chapter || "");
		const listKey = m.kind === "main" ? "missions" : "sub_missions";
		for (const cid of this.ids("chapter")) {
			const c = this.items.chapter[cid];
			let changed = false;
			for (const key of ["missions", "sub_missions"]) {
				const a = arr(c[key]).slice();
				const should = cid === want && key === listKey && !!this.items.mission[mid];
				const i = a.indexOf(mid);
				if (i >= 0 && !should) {
					a.splice(i, 1);
					changed = true;
				} else if (should && i < 0) {
					a.push(mid);
					changed = true;
				}
				c[key] = a;
			}
			if (changed) this.touch("chapter", cid);
		}
	}

	// 지금 내용을 파일 글로: { path: text | null }. 원본과 같으면 빠짐
	changes() {
		const out = {};
		for (const p of this.deleted) out[p] = null;
		for (const p of this.dirtyPaths) {
			const text = this.textFor(p);
			if (text === null) continue;
			if (text !== this.original[p]) out[p] = text;
		}
		return out;
	}
	textFor(path) {
		if (path === PROFILE_PATH) return stringify(this.profile);
		for (const [k, p] of Object.entries(SINGLE_FILES)) if (p === path) return stringify(this.single[k]);
		for (const [kind, dir] of Object.entries(DIRS)) {
			if (path.startsWith(dir)) {
				const it = this.items[kind][path.slice(dir.length, -5)];
				return it ? stringify(it) : null;
			}
		}
		return this.docs[path] !== undefined ? this.docs[path] : null;
	}
	// 초안(저장해 둔 변경) 적용: 그 파일 글을 다시 읽어 항목으로. text null = 삭제
	applyText(path, text) {
		if (text === null) {
			for (const [kind, dir] of Object.entries(DIRS)) if (path.startsWith(dir)) delete this.items[kind][path.slice(dir.length, -5)];
			if (this.original[path] !== undefined) this.deleted.add(path);
			return "";
		}
		if (this.docPaths().includes(path) && !path.endsWith(".json")) {
			this.docs[path] = text;
			this.dirtyPaths.add(path);
			return "";
		}
		const r = parse(text);
		if (r.error || !isObj(r.data)) return `${path}: ${r.error || "객체가 아님"}`;
		if (path === PROFILE_PATH) this.profile = r.data;
		for (const [k, p] of Object.entries(SINGLE_FILES)) if (p === path) this.single[k] = r.data;
		for (const [kind, dir] of Object.entries(DIRS)) if (path.startsWith(dir)) this.items[kind][path.slice(dir.length, -5)] = r.data;
		this.dirtyPaths.add(path);
		this.deleted.delete(path);
		return "";
	}
	hasChanges() {
		return Object.keys(this.changes()).length > 0;
	}
	// 커밋한 뒤: 지금 내용을 새 원본으로
	markCommitted(changes) {
		for (const [p, t] of Object.entries(changes)) {
			if (t === null) delete this.original[p];
			else this.original[p] = t;
		}
		this.dirtyPaths.clear();
		this.deleted.clear();
	}
}

export function isObj(v) {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}
export function arr(v) {
	return Array.isArray(v) ? v : [];
}
export function obj(v) {
	return isObj(v) ? v : {};
}
function num(v, d) {
	const n = Number(v);
	return Number.isFinite(n) ? n : d;
}
