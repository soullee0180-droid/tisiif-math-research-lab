# 최신 인계 · 공동 API와 추가 지시

최신 사용자 승인: 공개 방문자가 다른 사람의 공동 키를 사용해도 됨. 로그인은 계속 없음. 03_SHARED_API.md가 실제 API 차단을 대체한다.

API·프롬프트 화면에서 키/예산/모델/호출 한도/네 단계 지시를 관리한다. key 원문 읽기 endpoint는 없다. 과거 직접 write 관리자 경로는 계속 차단하고 좁은 api-config endpoint만 공유한다. backup/restore/member/서버 secret HTTP 노출 금지 유지.

Supabase Vault에 master/scheduler secret을 생성하며 값을 도구 출력/파일/로그에 쓰지 않는다. 고정 이름 server-role-only RPC fallback을 crypt/internal-auth에서 사용한다. 기존 1분 cron과 waitUntil 실행으로 브라우저를 닫아도 작동한다. 초기 API OFF와 예산 $0/키 0을 유지한다. 실제 모델 호출은 아직 키 입력 전이므로 0회다.

프로필당 네 단계 실제 진단 예약은 atomic/idempotent다. 추가 지시는 기본값+실험별 override를 plan INSERT 시 protocol/hash에 넣으며 immutable trigger를 우회하지 않는다. 실행 시 해당 단계의 문자열만 prompt에 붙인다. 전체비교는 세 제공사 text 네 단계 PASS 모델이 필요하며 PDF도 네 단계 별도 검증 필요.

검수 shared-api.ts는 HTTP mocked 12 probes+18 API jobs를 처리하고 키 비노출·지시 분리/불변·비밀 RPC 권한·재예약 방지를 검사한다. 모의와 실제 제공사 요청을 혼동하지 않는다. 실제 키는 사용자가 공개 사이트의 password 입력에 넣어야 하며 채팅에 요구하지 않는다.

프로젝트 bugnhvehtrsgehgnhlvm, GitHub soullee0180-droid/tisiif-math-research-lab/free/v3-from-scratch. Supabase migration/Edge 버전과 CI는 DEPLOYMENT_LEDGER.json. Pages는 Git 자동배포 연결됨. 연결된 PC Chrome의 공개 앱을 확인할 수 있으나 세션을 재사용하기 전 현재 상태를 먼저 읽는다.
