// 이 기기에만 남는 것: 설정(토큰·저장소 목록)은 localStorage, 불러온 데이터 캐시·작업 중 변경(초안)은 IndexedDB.
// 브라우저 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서도 앱은 동작한다 (저장만 안 됨).

import { DESKTOP } from "./local.js";

// PC 판은 저장소가 PC 폴더라 설정을 따로 둔다
const SETTINGS_KEY = DESKTOP ? "story-studio.desktop-settings" : "story-studio.settings";
const DB_NAME = "story-studio";
const DB_STORE = "repos";

export function loadSettings() {
	try {
		const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
		return {
			token: s.token || "",
			repos: Array.isArray(s.repos) && (s.repos.length || DESKTOP) ? s.repos : defaultRepos(),
			current: s.current || "",
		};
	} catch (_) {
		return { token: "", repos: defaultRepos(), current: "" };
	}
}

export function saveSettings(s) {
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
		return true;
	} catch (_) {
		return false;
	}
}

function defaultRepos() {
	if (DESKTOP) return [];
	return [
		{ owner: "hakgonc", name: "like-a-hero", branch: "main" },
		{ owner: "hakgonc", name: "SHATTERCORE-AFTER-THE-FALL", branch: "main" },
	];
}

export function repoKey(r) {
	if (r.path) return ("local:" + r.path).toLowerCase();
	return `${r.owner}/${r.name}@${r.branch}`.toLowerCase();
}

let dbPromise = null;
function db() {
	if (!dbPromise) {
		dbPromise = new Promise((resolve) => {
			try {
				const req = indexedDB.open(DB_NAME, 1);
				req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
			} catch (_) {
				resolve(null);
			}
		});
	}
	return dbPromise;
}

// { head: {sha, tree, ...}, files: {path: {sha, text}}, allPaths: [...], drafts: {path: text|null}, savedAt }
export async function loadRepoCache(key) {
	const d = await db();
	if (!d) return null;
	return new Promise((resolve) => {
		try {
			const req = d.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
			req.onsuccess = () => resolve(req.result || null);
			req.onerror = () => resolve(null);
		} catch (_) {
			resolve(null);
		}
	});
}

export async function saveRepoCache(key, value) {
	const d = await db();
	if (!d) return false;
	return new Promise((resolve) => {
		try {
			const tx = d.transaction(DB_STORE, "readwrite");
			tx.objectStore(DB_STORE).put(value, key);
			tx.oncomplete = () => resolve(true);
			tx.onerror = () => resolve(false);
		} catch (_) {
			resolve(false);
		}
	});
}
