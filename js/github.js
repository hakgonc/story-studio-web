// GitHub REST API 로 저장소의 파일을 읽고, 여러 파일을 한 커밋으로 올린다.
// 토큰은 이 기기 브라우저에만 저장된다 (store.js). 요청은 api.github.com 으로만 간다.

const API = "https://api.github.com";

export class GitHubError extends Error {
	constructor(status, message, body) {
		super(message);
		this.status = status;
		this.body = body;
	}
}

export class GitHub {
	constructor(token) {
		this.token = token;
	}

	async req(method, path, body) {
		const res = await fetch(API + path, {
			method,
			headers: {
				Authorization: "Bearer " + this.token,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
			cache: "no-store",
		});
		let data = null;
		try {
			data = await res.json();
		} catch (_) {
			data = null;
		}
		if (!res.ok) {
			const msg = (data && data.message) || res.statusText;
			throw new GitHubError(res.status, explain(res.status, msg), data);
		}
		return data;
	}

	user() {
		return this.req("GET", "/user");
	}

	repo(owner, name) {
		return this.req("GET", `/repos/${owner}/${name}`);
	}

	async headCommit(owner, name, branch) {
		const ref = await this.req("GET", `/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`);
		const commit = await this.req("GET", `/repos/${owner}/${name}/git/commits/${ref.object.sha}`);
		return { sha: commit.sha, tree: commit.tree.sha, message: commit.message, date: commit.committer && commit.committer.date };
	}

	async tree(owner, name, treeSha) {
		const t = await this.req("GET", `/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`);
		return { entries: t.tree.filter((e) => e.type === "blob"), truncated: !!t.truncated };
	}

	async blobText(owner, name, sha) {
		const b = await this.req("GET", `/repos/${owner}/${name}/git/blobs/${sha}`);
		return decodeBase64Utf8(b.content);
	}

	// changes: { path: 새 글(string) | null(삭제) }. baseCommit 위에 커밋하고 브랜치를 옮긴다.
	// 브랜치가 그사이 움직였으면 GitHubError(status 409/422, body.code = "not_fast_forward")
	async commit(owner, name, branch, base, changes, message) {
		const tree = Object.entries(changes).map(([path, text]) =>
			text === null ? { path, mode: "100644", type: "blob", sha: null } : { path, mode: "100644", type: "blob", content: text });
		const newTree = await this.req("POST", `/repos/${owner}/${name}/git/trees`, { base_tree: base.tree, tree });
		const c = await this.req("POST", `/repos/${owner}/${name}/git/commits`, { message, tree: newTree.sha, parents: [base.sha] });
		try {
			await this.req("PATCH", `/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: c.sha, force: false });
		} catch (e) {
			if (e instanceof GitHubError && (e.status === 422 || e.status === 409)) {
				e.code = "not_fast_forward";
			}
			throw e;
		}
		return { sha: c.sha, tree: newTree.sha, message };
	}
}

export function decodeBase64Utf8(b64) {
	const bin = atob(b64.replace(/\s/g, ""));
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder("utf-8").decode(bytes);
}

// git 이 계산하는 blob sha (변경 비교용): sha1("blob <바이트 수>\0" + 내용)
export async function gitBlobSha(text) {
	const body = new TextEncoder().encode(text);
	const head = new TextEncoder().encode(`blob ${body.length}\0`);
	const all = new Uint8Array(head.length + body.length);
	all.set(head);
	all.set(body, head.length);
	const hash = await crypto.subtle.digest("SHA-1", all);
	return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function explain(status, msg) {
	switch (status) {
		case 401:
			return "토큰이 맞지 않거나 만료됨 (설정에서 다시 넣기)";
		case 403:
			return msg.includes("rate limit") ? "GitHub 요청 한도 초과 — 잠시 뒤 다시" : "권한 없음: 토큰에 이 저장소 Contents 읽기·쓰기 권한이 필요 (" + msg + ")";
		case 404:
			return "찾을 수 없음: 저장소 이름·브랜치를 확인하거나, 토큰에 이 저장소 접근 권한을 주세요";
		default:
			return `GitHub 오류 ${status}: ${msg}`;
	}
}
