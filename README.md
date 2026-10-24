# TISIIF Math Research Lab · Free v3

React 19 / Vite 정적 앱 + Supabase Free PostgreSQL·Auth·private Storage·Edge Functions.
Cloudflare Pages Free에 배포하는 새 구현입니다. Railway·Render·유료 상시 실행기는 사용하지 않습니다.

실제 모델 호출은 기본 OFF, 예산은 $0입니다. 모의 결과는 fixture/mock, 웹 채팅 수동 결과는 별도 transport로 보존합니다.

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:sql
node --import tsx tests/integration/pipeline.ts
npm run test:stress
npm run build
npm run bundle:edge
```

프런트 환경은 `.env.example`을 참고합니다. build 결과는 `apps/web/dist`, Edge 번들은 `.edge-bundle`입니다.
서버 비밀은 Supabase 설정에만 두며, 저장소·프런트 빌드에 넣지 않습니다.

원본 명세는 [01_MASTER_PROMPT.md](01_MASTER_PROMPT.md), 실제 검수와 남은 제한은 [docs/TEST_REPORT.md](docs/TEST_REPORT.md)를 확인하세요.
아직 수행하지 않은 실제 Google 3계정·클라우드 예약·provider PDF 검수를 성공으로 간주하지 않습니다.
