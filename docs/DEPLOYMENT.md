# 공개판 배포

Google OAuth·이메일 초대·앱 로그인·Auth redirect 설정은 필요하지 않습니다. 기존 Cloudflare 계정 로그인은 호스팅 관리용이며 사이트 이용자 로그인과 별개입니다.

이미 연결된 Supabase 프로젝트: `bugnhvehtrsgehgnhlvm`. 기존 schema·bootstrap을 다시 실행하거나 reset하지 않습니다. 원격 migration 이력은 `DEPLOYMENT_LEDGER.json`과 비교합니다.

1. 새 `20261025003125_public_access.sql`과 `20261025004128_safe_usage_update.sql`만 기존 프로젝트에 적용합니다. DB 내부 공용 actor, 공개 요청 한도, mock claim을 추가하고 종전 Google/email identity 함수를 제거합니다. 업무 데이터는 보존합니다. 사용량 UPDATE는 단일 행 WHERE를 명시해 Supabase REST의 안전한 UPDATE 검사와 호환됩니다.
2. `npm ci --ignore-scripts && npm run check && npm test`와 public-access integration을 확인합니다.
3. `npm run bundle:edge`의 api 번들을 Supabase `api` 함수로 배포합니다. 공개 endpoint이므로 `verify_jwt=false`입니다. dispatch/execute의 HMAC 검증은 유지합니다.
4. Cloudflare Pages에서 GitHub `soullee0180-droid/tisiif-math-research-lab`, production branch **free/v3-from-scratch**, repository root 빈칸, build `npm ci --ignore-scripts && npm run build`, output **apps/web/dist**, Node 24를 사용합니다.
5. Production 환경에 `VITE_SUPABASE_URL=https://bugnhvehtrsgehgnhlvm.supabase.co`, `VITE_SUPABASE_PUBLISHABLE_KEY`를 설정합니다. publishable key는 공개 키입니다. service_role·secret key·모델 API 키를 넣지 않습니다.
6. Save and Deploy합니다. 기존 Pages Git 연결이 있으면 새 commit의 배포 상태를 확인합니다. 없다면 사용자 PC의 정상 로그인 세션에서 Pages Git 연결을 생성해야 합니다.
7. 생성된 HTTPS 주소를 시크릿 창에서 열어 가입 화면 없이 논문 목록이 나오는지 확인합니다. 새 논문·분기점 승인·수동 계획 또는 모의 계획을 확인합니다. 모의 계획은 ‘모의 작업 진행’을 누릅니다.

일반 공개 접속·수동·버튼 모의 실행에는 LAB_APP_ORIGIN, Google Client ID/Secret, LAB_SECRETS_MASTER_KEY, LAB_SCHEDULER_SECRET 설정이 필요하지 않습니다. 별도 브라우저 종료 후 cron 자동 실행을 운영할 때만 서버 scheduler secret/Vault 설정을 진행합니다. 공개 UI로 해당 운영 설정을 변경할 수 없습니다.

원본 PDF와 기준 아이디어도 공개 공동 자료입니다. 방문자별 비공개 공간이나 실제 사람을 구분하는 로그인 기록은 제공하지 않습니다.
