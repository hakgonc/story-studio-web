# Story Studio 웹

게임별 세계관·장·미션·대사·이벤트씬을 공통 형식(story-data/1)으로 고치고 GitHub 에 바로 커밋하는 웹 앱. 휴대폰·PC 브라우저 어디서나 쓰고, 홈 화면에 추가하면 앱처럼 열린다.

- 열기: https://hakgonc.github.io/story-studio-web/
- 데이터는 각 게임의 **비공개 저장소**에 그대로 있다. 이 저장소에는 앱 코드만 있다
- 처음 열면 「설정」에 GitHub Fine-grained 토큰(대상 저장소의 Contents 읽기·쓰기)을 넣는다. 토큰은 그 기기 브라우저에만 저장되고 api.github.com 으로만 보낸다
- 불러온 데이터와 커밋 전 변경은 기기에 저장되어 오프라인에서도 열린다

소스 원본은 비공개 저장소 hakgonc/story-studio 의 `web/` 이고, 이 저장소는 배포용 사본이다. 고칠 때는 story-studio 에서 고친 뒤 복사한다.
