# 현재 작업 인계 · 공개판

최신 사용자 지시: 로그인·초대 제한 전체 제거, 누구나 URL로 접속, 디자인 최소화. `02_PUBLIC_ACCESS.md`가 이전 master의 계정 요구를 대체합니다. 이전 Google 3계정·팀 이메일·OAuth 설정 작업을 재개하지 않습니다.

클라이언트 Auth SDK·토큰·OAuth callback·로그아웃·초대 및 관리자 화면을 제거했습니다. 공개 Edge API는 공용 researcher actor를 서버에서 선택합니다. 개인 Auth 사용자를 만들지 않습니다. 공개 전용 요청 한도와 연구 action allowlist를 적용하고, 민감 운영 action은 HTTP로 제공하지 않습니다. 직접 anon DB/RPC 접근은 계속 차단합니다.

공용 자료는 원본 파일과 기준 아이디어까지 방문자가 열람·편집합니다. 독립 개인 검토자 배정 기능은 제거했고, 과거 자료와 내부 연구·복원 코드는 보존합니다. 실제 API OFF·예산 $0 유지. 공용 mock step은 기존 atomic claim을 재사용하며 mock 외 claim은 트랜잭션에서 거부합니다.

Supabase API v4 및 신규 migration 두 개를 적용했고 실제 HTTPS에서 무인증 /me·papers 200, 관리자 경로 403, 공용 작성 200과 빈 mock step 200을 확인했습니다. 새 전체 GitHub CI 40147864591이 성공했습니다(code 21bb701). 32 unit, SQL/공개 접근/18-job mock/권한·요청한도, 실제 PG17 동시성, 7,200-job mock stress, build/Deno, 로그인 없는 Chromium·모바일 및 PDF 제거 검수 모두 통과했습니다. CI 모의 검수와 실제 모델 호출을 혼동하지 않습니다.

**공개 사이트 게시 완료: https://tisiif-math-research-lab.pages.dev**. PC 연결 Chrome에서 기존 로그인된 Cloudflare 탭을 확인해 Pages 배포를 발견했습니다. production branch free/v3-from-scratch, code commit 21bb701, deployment 9d74f6e5-a609-4d8a-b3ee-7b63746de2dd, 자동 Git 배포 ON을 확인했습니다. 실제 사이트 네 메뉴와 새로고침이 로그인 없이 정상 표시됩니다. Cloud browser의 호스팅 계정 로그인 실패는 PC 연결 브라우저와 별개이며 이제 배포 blocker가 아닙니다.

선택적 무인 cron과 실제 TUS 추가 검수는 남아 있습니다. 일반 공개 접속·수동·모의 버튼 실행에 OAuth/서버 추가 secrets는 필요 없습니다. 무인 cron은 아직 OFF이며 자동 실행 완료를 주장하지 않습니다.
GitHub: soullee0180-droid/tisiif-math-research-lab, branch free/v3-from-scratch, PR 1. 원격 변경은 lease를 걸어 기존 이력을 보존합니다. 기존 schema를 reset하거나 전체 migration을 재적용하지 않습니다. public_access와 safe_usage_update 두 신규 migration을 적용합니다. 원격 API v4와 공개 migration 두 개 반영을 확인했습니다. 무인증 /me 및 /read/papers 200, /read/settings 403을 실제 HTTPS에서 확인했습니다. 사용량 함수의 WHERE 누락으로 PostgREST 21000 오류가 발생한 것을 singleton WHERE로 수정했습니다.
