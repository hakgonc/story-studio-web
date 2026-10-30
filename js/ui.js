// 화면 도우미: 요소 만들기 h(), 칸 폼 fieldForm() (Godot 판 FieldForm 과 같은 칸 종류), 알림·확인 창
import { stringify, clone } from "./storyjson.js";

export function h(tag, attrs = {}, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v === undefined || v === null || v === false) continue;
		if (k === "class") el.className = v;
		else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
		else if (k === "html") el.innerHTML = v;
		else if (k in el && typeof v !== "string") el[k] = v;
		else el.setAttribute(k, v === true ? "" : v);
	}
	for (const c of children.flat(Infinity)) {
		if (c === null || c === undefined || c === false) continue;
		el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	}
	return el;
}

export function clear(el) {
	while (el.firstChild) el.removeChild(el.firstChild);
	return el;
}

let toastTimer = 0;
export function toast(text, error = false) {
	const t = document.getElementById("toast");
	t.textContent = text;
	t.className = "toast show" + (error ? " error" : "");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (t.className = "toast"), error ? 6000 : 2600);
}

export function confirmBox(text, okText = "확인") {
	return new Promise((resolve) => {
		const dlg = h("dialog", { class: "modal" },
			h("p", { class: "pre" }, text),
			h("div", { class: "row end" },
				h("button", { class: "btn", onclick: () => close(false) }, "취소"),
				h("button", { class: "btn primary", onclick: () => close(true) }, okText)));
		function close(v) {
			dlg.close();
			dlg.remove();
			resolve(v);
		}
		document.body.append(dlg);
		dlg.showModal();
	});
}

export function promptBox(title, value = "", hint = "") {
	return new Promise((resolve) => {
		const input = h("input", { class: "input", value, autocapitalize: "off", autocorrect: "off", spellcheck: false });
		const dlg = h("dialog", { class: "modal" },
			h("h3", {}, title),
			input,
			hint ? h("div", { class: "hint" }, hint) : null,
			h("div", { class: "row end" },
				h("button", { class: "btn", onclick: () => close(null) }, "취소"),
				h("button", { class: "btn primary", onclick: () => close(input.value.trim()) }, "확인")));
		input.addEventListener("keydown", (e) => e.key === "Enter" && close(input.value.trim()));
		function close(v) {
			dlg.close();
			dlg.remove();
			resolve(v);
		}
		document.body.append(dlg);
		dlg.showModal();
		input.focus();
		input.select();
	});
}

// 딕셔너리 하나를 칸으로 고친다. 정의에 없는 키는 "기타 키 (JSON)" 칸에 남아 지워지지 않는다.
// defs: [{ key, label, type, options?, hint?, readonly?, rows? }]
//   type: text / multiline / int / float / bool / enum / ref(빈 값 허용) / json / lines / csv
// onChange(key): 값이 바뀔 때마다 (data 는 바로 고쳐짐)
export function fieldForm(data, defs, onChange, title = "") {
	const form = h("div", { class: "form" });
	if (title) form.append(h("h3", { class: "form-title" }, title));
	const shown = new Set(defs.map((d) => d.key));
	const set = (key, value, erase) => {
		if (erase) delete data[key];
		else data[key] = value;
		onChange(key);
	};
	for (const d of defs) form.append(field(data, d, set));
	const extra = {};
	for (const k of Object.keys(data)) if (!shown.has(k)) extra[k] = data[k];
	const err = h("div", { class: "err" });
	const ta = h("textarea", { class: "input code", rows: Math.min(8, Math.max(2, stringify(extra).split("\n").length)), spellcheck: false });
	ta.value = Object.keys(extra).length ? stringify(extra).trimEnd() : "{}";
	ta.addEventListener("input", () => {
		let v;
		try {
			v = JSON.parse(ta.value || "{}");
		} catch (e) {
			err.textContent = "JSON 오류 — 저장되지 않음: " + e.message;
			return;
		}
		if (!v || typeof v !== "object" || Array.isArray(v)) {
			err.textContent = "JSON 객체가 아님 — 저장되지 않음";
			return;
		}
		err.textContent = "";
		for (const k of Object.keys(data)) if (!shown.has(k) && !(k in v)) delete data[k];
		for (const [k, x] of Object.entries(v)) if (!shown.has(k)) data[k] = x;
		onChange("");
	});
	form.append(h("details", { class: "extra" }, h("summary", {}, "기타 키 (JSON) — 위 칸에 없는 값·메모"), ta, err));
	return form;
}

function field(data, d, set) {
	const type = d.type || "text";
	const value = data[d.key];
	const label = h("label", { class: "label" }, d.label || d.key, d.hint ? h("span", { class: "hint" }, " " + d.hint) : null);
	const wrap = h("div", { class: "field" }, label);
	const ro = !!d.readonly;
	if (type === "text") {
		const e = h("input", { class: "input", value: value ?? "", readOnly: ro });
		e.addEventListener("input", () => set(d.key, e.value, e.value === ""));
		wrap.append(e);
	} else if (type === "int" || type === "float") {
		const e = h("input", { class: "input", value: value ?? "", inputmode: "decimal", readOnly: ro, placeholder: "숫자" });
		e.addEventListener("input", () => {
			const t = e.value.trim();
			if (t === "") set(d.key, null, true);
			else if (!isNaN(Number(t))) set(d.key, type === "int" ? Math.trunc(Number(t)) : Number(t), false);
		});
		wrap.append(e);
	} else if (type === "bool") {
		const e = h("input", { type: "checkbox", checked: !!value, disabled: ro });
		e.addEventListener("change", () => set(d.key, e.checked, !e.checked && !(d.key in data)));
		wrap.append(h("label", { class: "check" }, e, " 예"));
	} else if (type === "multiline") {
		const e = h("textarea", { class: "input", rows: d.rows || 3, readOnly: ro });
		e.value = value ?? "";
		e.addEventListener("input", () => set(d.key, e.value, e.value === ""));
		wrap.append(e);
	} else if (type === "enum" || type === "ref") {
		const opts = (d.options || []).map(String);
		const cur = value === undefined || value === null ? "" : String(value);
		const values = type === "ref" ? [""] : [];
		values.push(...opts);
		if (!values.includes(cur)) values.push(cur);
		const e = h("select", { class: "input", disabled: ro },
			values.map((v) => h("option", { value: v, selected: v === cur }, v === "" ? "(없음)" : opts.includes(v) ? (d.labels && d.labels[v]) || v : v + "  ⚠ 목록에 없음")));
		e.addEventListener("change", () => set(d.key, e.value, e.value === "" && type === "ref"));
		wrap.append(e);
	} else if (type === "lines" || type === "csv") {
		const list = Array.isArray(value) ? value.map(String) : [];
		const e = type === "lines" ? h("textarea", { class: "input", rows: d.rows || 3, readOnly: ro }) : h("input", { class: "input", readOnly: ro });
		e.value = type === "lines" ? list.join("\n") : list.join(", ");
		e.addEventListener("input", () => {
			const out = e.value.split(type === "lines" ? "\n" : ",").map((s) => s.trim()).filter(Boolean);
			set(d.key, out, !out.length && !(d.key in data));
		});
		wrap.append(e);
	} else if (type === "json") {
		const e = h("textarea", { class: "input code", rows: d.rows || 4, readOnly: ro, spellcheck: false });
		e.value = value === undefined ? "" : stringify(value).trimEnd();
		const err = h("div", { class: "err" });
		e.addEventListener("input", () => {
			if (e.value.trim() === "") {
				err.textContent = "";
				set(d.key, null, true);
				return;
			}
			try {
				const v = JSON.parse(e.value);
				err.textContent = "";
				set(d.key, v, false);
			} catch (x) {
				err.textContent = "JSON 오류 — 저장되지 않음: " + x.message;
			}
		});
		wrap.append(e, err);
	}
	return wrap;
}

export { clone };
