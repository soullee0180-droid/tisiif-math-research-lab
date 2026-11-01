# 인계 · 3.5

현재 구현과 배포 절차는 [IMPLEMENTATION_20261029.md](IMPLEMENTATION_20261029.md), [DEPLOYMENT_3_5.md](DEPLOYMENT_3_5.md)를 기준으로 한다. 예전 보고서의 구현 범위·검수 수치는 해당 시점의 기록이다.

공개 공동 편집과 공동 키는 의도된 설계다. 개인 신원 인증/Google 로그인은 없다. 유료 API 설정은 공개이고 서버의 별도 `server_budget_caps`를 공개 HTTP로 올릴 수 없다. 독립 채점의 검토자 코드는 별도 사람의 자기 신고 식별자이며 공용 계정을 두 명으로 해석하지 않는다.

기존 수학 idea와 ML 네 과제를 구분한다. 새 단계는 research이며 전용 frozen bundle과 결과 테이블을 쓴다. 계획별 입력·모델 snapshot, 기존 승인본 불변성, 원문 저장, ambiguous remote 자동 재전송 금지를 유지한다. DB reset이나 과거 migration 재적용 금지.

키·서비스 비밀을 로그/보고서/Git에 쓰지 않는다. 실제 모델 호출은 별도 유료 검증 절차이며 모의 테스트 결과로 키 성공을 주장하지 않는다. 배포/유료 검증 이력은 실제 실행한 뒤에만 기록한다.
