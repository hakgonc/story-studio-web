// PC 판(StoryStudio.exe): 같은 화면이 PC 의 로컬 서버(desktop/server.go)를 거쳐 게임 저장소 폴더를 읽고 쓰고 git 을 부른다.
// window.STUDIO_DESKTOP 은 PC 판 서버가 index.html 에 넣어 준다 ({token, version}). 웹(휴대폰)에서는 null.

export const DESKTOP = (typeof window !== "undefined" && window.STUDIO_DESKTOP) || null;

export class LocalError extends Error {
	constructor(status, message, body) {
		super(message);
		this.status = status;
		this.body = body || {};
	}
}

async function api(name, params = {}, body = null) {
	const url = "/api/" + name + (body ? "" : "?" + new URLSearchParams(params));
	const res = await fetch(url, {
		method: body ? "POST" : "GET",
		headers: { "X-Studio-Token": DESKTOP.token, ...(body ? { "Content-Type": "application/json" } : {}) },
		body: body ? JSON.stringify({ ...params, ...body }) : undefined,
		cache: "no-store",
	});
	if (name === "file" && res.ok) return res.text();
	let data = null;
	try {
		data = await res.json();
	} catch (_) {
		data = null;
	}
	if (!res.ok) throw new LocalError(res.status, (data && data.error) || res.statusText, data);
	return data;
}

export const local = {
	info: () => api("info"),
	scan: () => api("scan"),
	pick: (title) => api("pick", {}, { title }),
	check: (repo) => api("check", { repo }),
	head: (repo) => api("head", { repo }),
	tree: (repo) => api("tree", { repo }),
	read: (repo, path) => api("file", { repo, path }),
	// changes {path: 글|null}, expect {path: 읽을 때 sha|""} → {shas, head}. 디스크에서 바뀌었으면 LocalError 409 body.clash
	save: (repo, changes, expect, force = false) => api("save", { repo }, { changes, expect, force }),
	status: (repo) => api("git/status", { repo }),
	commit: (repo, message, paths) => api("git/commit", { repo }, { message, paths }),
	pull: (repo) => api("git/pull", { repo }, {}),
	push: (repo) => api("git/push", { repo }, {}),
	vendor: (repo) => api("vendor", { repo }, {}),
};

// 폴더 경로 → 저장소 항목 {path, name}
export function localRepo(path) {
	const clean = path.replace(/[\\/]+$/, "");
	return { path: clean, name: clean.split(/[\\/]/).pop() || clean };
}
