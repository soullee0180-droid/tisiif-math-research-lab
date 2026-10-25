# 현재 작업 인계 · 공개판

최신 사용자 지시: 로그인·초대 제한 전체 제거, 누구나 URL로 접속, 디자인 최소화. `02_PUBLIC_ACCESS.md`가 이전 master의 계정 요구를 대체합니다. 이전 Google 3계정·팀 이메일·OAuth 설정 작업을 재개하지 않습니다.

클라이언트 Auth SDK·토큰·OAuth callback·로그아웃·초대 및 관리자 화면을 제거했습니다. 공개 Edge API는 공용 researcher actor를 서버에서 선택합니다. 개인 Auth 사용자를 만들지 않습니다. 공개 전용 요청 한도와 연구 action allowlist를 적용하고, 민감 운영 action은 HTTP로 제공하지 않습니다. 직접 anon DB/RPC 접근은 계속 차단합니다.

공용 자료는 원본 파일과 기준 아이디어까지 방문자가 열람·편집합니다. 독립 개인 검토자 배정 기능은 제거했고, 과거 자료와 내부 연구·복원 코드는 보존합니다. 실제 API OFF·예산 $0 유지. 공용 mock step은 기존 atomic claim을 재사용하며 mock 외 claim은 트랜잭션에서 거부합니다.

원격 backend 반영·CI 상태는 DEPLOYMENT_LEDGER.json을 확인합니다. Cloudflare cloud-browser의 호스팅 관리자 로그인은 실제 POST /api/v4/login 403으로 두 차례 실패했습니다. 사용자 PC에서는 로그인 가능하지만, 실제 pages.dev 배포 주소는 아직 전달받지 못했습니다. 같은 인증을 자동 재시도하지 않습니다. Pages frontend 배포 완료를 확인하기 전 전체 공개 사이트의 배포 완료라고 보고하지 않습니다.

GitHub: soullee0180-droid/tisiif-math-research-lab, branch free/v3-from-scratch, PR 1. 원격 변경은 lease를 걸어 기존 이력을 보존합니다. 기존 schema를 reset하거나 전체 migration을 재적용하지 않습니다. public_access와 safe_usage_update 두 신규 migration을 적용합니다. 원격 API v4와 공개 migration 두 개 반영을 확인했습니다. 무인증 /me 및 /read/papers 200, /read/settings 403을 실제 HTTPS에서 확인했습니다. 사용량 함수의 WHERE 누락으로 PostgREST 21000 오류가 발생한 것을 singleton WHERE로 수정했습니다.
