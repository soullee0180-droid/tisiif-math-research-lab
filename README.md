# TISIIF Math Research Lab · 공개판 3.1

주소로 바로 접속하는 공개 공동 연구 공간입니다. Google 로그인·회원가입·이메일 초대·로그아웃 기능이 없습니다. 방문자는 같은 논문·분기점·실험 결과를 보고 편집합니다.

React / Vite 정적 앱 + Supabase Free PostgreSQL·private Storage·Edge Functions, Cloudflare Pages Free를 사용합니다. 흰 배경과 상단 메뉴 네 개로 화면을 단순화했습니다. Railway·Render·유료 플랜은 사용하지 않습니다.

수동 웹 실험과 합성 mock 실험을 제공합니다. 공개 화면에서 실제 모델 API·예산·키·구성원·복원 관리 작업을 실행할 수 없습니다. 모의 작업은 실행 현황 또는 계획의 **모의 작업 진행** 버튼으로 최대 세 개씩 처리할 수 있습니다. 서버 cron을 별도로 연결하지 않아도 작동하며, 탭을 닫은 상태의 예약 실행은 별도 운영 설정이 필요합니다.

등록한 원본 파일·기준 아이디어·결과도 모든 방문자가 볼 수 있습니다. 여기서 ‘공개 입력’은 모델에 보내는 입력이라는 뜻이며 웹사이트 접근 제한을 뜻하지 않습니다. 개인별 로그인 기록·독립 검토자 신원은 수집하지 않습니다. 예전 연구 데이터·Git 이력은 보존합니다.

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:sql
node --import tsx tests/integration/public-access.ts
node --import tsx tests/integration/pipeline.ts
npm run build
npm run bundle:edge
```

환경 변수는 `.env.example`, 배포는 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)를 참고하세요. build 결과는 `apps/web/dist`입니다. 서비스 키와 서버 비밀은 프런트·저장소에 넣지 않습니다. DB 직접 접근은 계속 차단하고, 공개 Edge API에서 허용한 연구 작업만 제공합니다. 요청량·파일 크기·저장 용량·불변 결과 제한도 유지합니다.

[02_PUBLIC_ACCESS.md](02_PUBLIC_ACCESS.md)가 원본 [01_MASTER_PROMPT.md](01_MASTER_PROMPT.md)의 로그인·초대·관리 화면 요구보다 우선합니다. 이전 문서의 Google 계정 검수는 공개판 배포 요건에서 제외되었습니다.
