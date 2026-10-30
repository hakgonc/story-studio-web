// 도움말: help.md(= docs/HELP.md 사본)를 "## 제목 {#id}" 단위로 나눠 보여 준다. PC 판 ui/help_window.gd 와 같은 나누기
import { h } from "./ui.js";
import { markdownToHtml } from "./markdown.js";

let sections = null;

// [{id, title, body}]. 첫 "## " 앞(문서 제목 제외)은 첫 절 앞에 붙인다
export function parseHelp(md) {
	const out = [];
	const intro = [];
	let cur = null;
	for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
		const m = line.startsWith("## ") ? /^##\s+(.*?)\s*(?:\{#([a-z0-9_-]+)\})?\s*$/.exec(line) : null;
		if (m) {
			cur = { id: m[2] || m[1], title: m[1], lines: [] };
			out.push(cur);
		} else if (!cur) {
			if (!line.startsWith("# ")) intro.push(line);
		} else cur.lines.push(line);
	}
	for (const s of out) {
		s.body = s.lines.join("\n").trim();
		delete s.lines;
	}
	const introText = intro.join("\n").trim();
	if (out.length && introText) out[0].body = introText + "\n\n" + out[0].body;
	return out;
}

export async function loadHelp() {
	if (!sections) {
		const res = await fetch("help.md", { cache: "no-cache" });
		if (!res.ok) throw new Error("도움말을 불러오지 못함 (" + res.status + ")");
		sections = parseHelp(await res.text());
	}
	return sections;
}

// 도움말 화면. onPick(id) 로 다른 절, onClose() 로 돌아감
export function renderHelp(v, list, id, onPick, onClose) {
	const cur = list.find((s) => s.id === id) || list[0];
	v.append(h("div", { class: "help" },
		h("div", { class: "row help-head" },
			h("button", { class: "btn small", onclick: onClose }, "← 돌아가기"),
			h("strong", { class: "grow" }, "도움말")),
		h("nav", { class: "chips" },
			list.map((s) => h("button", { class: "chip" + (s === cur ? " on" : ""), onclick: () => onPick(s.id) }, s.title))),
		cur ? h("article", { class: "md card help-body", html: markdownToHtml(`# ${cur.title}\n\n${cur.body}`) }) : h("div", { class: "empty" }, "도움말이 비어 있음")));
}
