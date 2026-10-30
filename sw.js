// 앱 화면 파일을 캐시해 오프라인에서도 열리게 한다. GitHub API 요청은 캐시하지 않는다 (데이터 캐시는 IndexedDB).
const CACHE = "story-studio-v0.4.0";
const SHELL = ["./", "index.html", "style.css", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
	"help.md", "js/app.js", "js/help.js", "js/local.js", "js/dialogue_view.js", "js/github.js", "js/markdown.js", "js/project.js", "js/store.js", "js/storyjson.js", "js/ui.js", "js/validator.js"];

self.addEventListener("install", (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
	e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// 화면 파일: 네트워크 먼저(새 버전 바로 반영), 안 되면 캐시
self.addEventListener("fetch", (e) => {
	const url = new URL(e.request.url);
	if (url.origin !== location.origin || e.request.method !== "GET") return;
	e.respondWith(fetch(e.request).then((res) => {
		const copy = res.clone();
		caches.open(CACHE).then((c) => c.put(e.request, copy));
		return res;
	}).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});
