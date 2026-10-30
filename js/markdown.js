// 문서 미리보기용 작은 Markdown → HTML (제목·굵게·코드·목록·표·인용·가로줄·링크). 입력은 항상 이스케이프한다.

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s) {
	s = esc(s);
	s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
	s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
	s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => (/^https?:\/\//.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : `<u>${t}</u>`));
	return s;
}

export function markdownToHtml(md) {
	const out = [];
	const lines = md.replace(/\r\n/g, "\n").split("\n");
	let i = 0;
	let list = null;
	const closeList = () => {
		if (list) {
			out.push(`</${list}>`);
			list = null;
		}
	};
	while (i < lines.length) {
		const line = lines[i];
		if (line.startsWith("```")) {
			closeList();
			const buf = [];
			i++;
			while (i < lines.length && !lines[i].startsWith("```")) buf.push(esc(lines[i++]));
			out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
			i++;
			continue;
		}
		if (line.startsWith("|")) {
			closeList();
			const rows = [];
			while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
			const cells = (r) => r.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => inline(c.trim()));
			const body = rows.filter((r) => !/^\|[\s:|-]+\|?\s*$/.test(r));
			out.push('<div class="table-wrap"><table>');
			body.forEach((r, n) => {
				const tag = n === 0 ? "th" : "td";
				out.push("<tr>" + cells(r).map((c) => `<${tag}>${c}</${tag}>`).join("") + "</tr>");
			});
			out.push("</table></div>");
			continue;
		}
		const h = /^(#{1,6})\s+(.*)$/.exec(line);
		if (h) {
			closeList();
			out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
		} else if (/^\s*---\s*$/.test(line)) {
			closeList();
			out.push("<hr>");
		} else if (line.startsWith("> ")) {
			closeList();
			out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
		} else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
			const ordered = /^\s*\d+\./.test(line);
			const want = ordered ? "ol" : "ul";
			if (list !== want) {
				closeList();
				out.push(`<${want}>`);
				list = want;
			}
			out.push(`<li>${inline(line.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`);
		} else if (line.trim() === "") {
			closeList();
		} else {
			closeList();
			out.push(`<p>${inline(line)}</p>`);
		}
		i++;
	}
	closeList();
	return out.join("\n");
}
