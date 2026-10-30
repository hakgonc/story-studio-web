// 스토리 데이터 JSON 쓰기 모양: 탭 들여쓰기, 정수는 정수, 끝에 줄바꿈.
// Story Studio(Godot) core/story_json.gd·변환 도구(파이썬)와 같은 모양이라 어느 쪽에서 저장해도 Git 차이가 없다.

export function stringify(value) {
	return JSON.stringify(value, null, "\t") + "\n";
}

export function parse(text) {
	try {
		return { data: JSON.parse(text), error: "" };
	} catch (e) {
		return { data: null, error: "JSON 오류: " + e.message };
	}
}

export function clone(v) {
	return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
