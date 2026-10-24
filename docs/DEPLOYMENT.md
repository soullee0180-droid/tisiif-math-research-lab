# 무료 배포

인프라: Cloudflare Pages Free 정적 SPA + 기존 연구용 Supabase Free 프로젝트. Pages Functions·Railway·Render·유료 실행기는 없다.

1. `npm ci --ignore-scripts`, 타입·unit·SQL·pipeline·stress 검수를 실행한다.
2. Supabase 기존 schema/history/advisor와 사용자 자료를 먼저 확인한다. 이 migration은 기존 `lab`/`lab_private`를 `lab_legacy_v2`/`lab_private_legacy_v2`로 보존한다. 활성 데이터를 삭제하지 않는다. 재적용·reset하지 않는다.
3. migration을 파일 순서대로 한 경로에서 적용한다. 마지막에 확인된 관리자 이메일만 새 allowlist에 seed하고 protocol JSON·제공사 예산 $0을 넣는다. 다른 팀원의 이메일은 관리자 설정으로 추가한다. `LAB_BOOTSTRAP_ADMIN_EMAIL`에 확인된 이메일을 지정하고 `node scripts/bootstrap.mjs`로 생성한 SQL을 검토한 뒤 적용한다. 이 스크립트는 SQL을 출력하며 DB를 직접 바꾸지 않는다.
4. `npm run bundle:edge`로 api/dispatch/execute를 번들한다. 모두 자체 인증을 하므로 gateway `verify_jwt=false`다. api는 Auth `/user`로 검증된 Google 사용자와 현재 membership을 검사한다. 내부 함수는 HMAC·시각·일회용 nonce를 검사한다.
5. Supabase Edge Secrets에 `LAB_SECRETS_MASTER_KEY`(32 random bytes base64), `LAB_SCHEDULER_SECRET`(32자 이상), 실제 `LAB_APP_ORIGIN`을 관리자 보안 설정으로 넣는다. 비밀은 소스·프런트 환경에 넣지 않는다.
6. Cloudflare Pages: 저장소 `soullee0180-droid/tisiif-math-research-lab`, 검수가 성공한 무료판 commit, Node 24, build `npm ci --ignore-scripts && npm run build`, output `apps/web/dist`. Free 플랜과 기본 pages.dev만 사용한다.
7. Pages에 `VITE_SUPABASE_URL`, **publishable** key만 설정한다. Google OAuth의 authorized origin/redirect, Supabase Site URL·redirect allowlist, Edge CORS origin을 실제 HTTPS 주소와 연결한다. Gmail/Drive 권한을 요청하지 않는다.
8. 설정에서 scheduler secret 존재를 확인한 뒤 Vault·cron 설치 버튼을 사용한다. 초기 OFF. 실제 cloud mock 예약·PC 종료·중복 기동·복구 검수를 통과한 뒤 운영 토글을 켠다.

Secrets와 Google OAuth는 현재 연결된 Supabase 도구에 설정 기능이 없어 Dashboard 인증이 필요하다. Cloudflare 플러그인이 없어 해당 배포도 공식 Dashboard를 사용한다. 비밀번호·OTP·키를 채팅으로 전달하지 않는다.

모델 키·API 예산이 없으면 실제 연결 검수는 BLOCKED로 남긴다. API 프로필은 정확한 ID·공식 가격·최대 요청 비용을 입력하고 각 단계별 1회 검수를 별도로 허용해야 한다. PDF 자동 API 경로도 별도 준비 단위로 구현되어 있다. 실제 remote-file 업로드·만료·각 단계 검수를 통과하기 전까지 capability gate로 차단한다.
