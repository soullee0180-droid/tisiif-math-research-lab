# 이어서 할 작업 (2026-10-24)

현재 v3 소스를 계속 사용한다. 전체 재삭제·재구축하지 않는다. 사용자는 최신 소스·master를 지정 private GitHub 저장소에 업로드하는 것을 승인했다. 저장소 soullee0180-droid/tisiif-math-research-lab, 브랜치 free/v3-from-scratch, Primary link_6ac85796c440819182c66af311481f5a. main은 이전 코드다.

검수된 구현 commit d246ab3a62f5f734c8ea2ee733ced304dcb9f805, CI run 40142289144 전체 PASS. unit32·embedded PG·실제 PostgreSQL17 동시성·7,200 mock·빌드·Deno·1440/390 UI·실제 PDF Worker·독립 pypdf를 포함한다. 실제 모델 호출 0. 이후 문서·배포 ledger만 갱신했다.

Supabase bugnhvehtrsgehgnhlvm / 조직 ckdplgeglvvjwulwecro는 Free다. 새 업무 DB와 4 private bucket, API·대기열·복원·scheduler 확장/함수·admission·provider file 함수를 모두 적용했다. api/dispatch/execute 3개 Edge v1 ACTIVE. health200, 미인증401, 잘못된CORS403, 서명없는내부함수403 실제 HTTPS 확인. 기존 28개 표는 lab_legacy_v2/lab_private_legacy_v2에 보존했다. 자료 삭제 없음. 관리자 allowlist soullee0180@gmail.com 한 명, API OFF·예산 전부 $0·scheduler OFF·실제 cron job 0. 다른 팀원 2명 이메일 미확인. 보안 advisor WARN/ERROR 0, INFO45는 서버 전용 private 표의 의도된 사용자 정책 없음이다.

DEPLOYMENT_LEDGER.json의 원격 이력을 먼저 읽는다. MCP의 긴 단일 요청이 Invalid or expired requestState로 실패해 같은 SQL을 함수 단위로 검토·적용했다. 자료/실험/관리 쓰기 helper는 source 자체도 나누었고 모든 검수를 다시 통과했다. 로컬 migration timestamp와 원격 version은 다르므로 reset·db push·이미 적용한 DDL 재실행을 하지 않는다. bootstrap도 이미 완료했다.

남은 것은 Cloudflare Pages Free 배포 로그인, Supabase Dashboard의 Edge secrets와 Google OAuth 설정, 팀 3계정 검수 및 실제 Storage·cron mock·백업/복원이다. Cloudflare 플러그인 없음, Supabase 도구에 secrets/Auth config setter 없음. Cloud Browser의 Cloudflare 로그인은 아직 완료하지 않았다. 보안 로그인은 browserAuth를 쓰고 암호·OTP·키를 채팅으로 받지 않는다. 서버 secret은 LAB_SECRETS_MASTER_KEY(32randombytes base64), LAB_SCHEDULER_SECRET(32자 이상), 실제 LAB_APP_ORIGIN이다. 소스·프런트에 넣지 않는다. 소스와 공개 publishable key만 Cloudflare에 배포한다.

무료 월 고정비 $0. Railway·Render·유료 서비스·카드 입력 없음. 실제 모델 예산·키·각 단계 검수 허용 전 실제 provider를 호출하지 않는다. 이 구현에 mock PASS를 실제 모델 PASS로 표시하지 않는다. 실제 클라우드 데이터 검수와 CI를 구분한다.

Cloudflare 후속 인증: Cloud Browser의 dash.cloudflare.com/login에서 browserAuth가 submitted를 반환했지만, 실제 화면에 API Request Failed: post https://dash.cloudflare.com/api/v4/login (403)이 표시됐다. 로그인 성공이 아니다. 자동 재시도를 하지 않는다. 같은 로그인 탭에서 수동 인증 handoff로 이어간다. 비밀번호나 계정 식별자는 기록·추측하지 않는다.
