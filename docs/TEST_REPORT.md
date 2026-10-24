# 검수 기록

2026-10-24. 아래 PASS는 실제 실행한 범위에만 해당한다. Cloudflare 공개 배포와 실제 팀 OAuth가 끝났다는 의미가 아니다.

| 환경 | 결과 | 증거 |
|---|---|---|
| TypeScript / production build / Edge bundle | PASS | npm run check/build/bundle:edge |
| 순수 계약·지표·암호화·Excel | PASS | Vitest 32 tests, M01~M04, equal paper weights, null/common set, schema K1/5/10, Merkle corruption, AES AAD, XLSX roundtrip |
| 실제 embedded PostgreSQL 기본 | PASS | 승인 불변·멱등 충돌·타인 계획 거절·직접 anon RPC 거절·6단계 |
| 로컬 DB + 메모리 객체 저장 전체 | PASS | 36 jobs, 72 actual raw byte objects, hidden canary 차단, blind review, 원문 우선 저장, 재파싱 추가 호출 0, unknown lease, 전체 행+raw 새 비활성 공간 복원 |
| 로컬 대량 mock | PASS | 7,200 logical jobs, 14,400 raw objects, 2 owners × 3,600 complete, provider network calls 0, 162,532ms |
| npm audit | PASS | 알려진 취약점 0 |
| Deno API type check | PASS | deno check, runtime dependency lock |
| 클라우드 조직 플랜·초기 자료 | PASS (확인 범위) | Supabase free/tier_free, ACTIVE_HEALTHY, 0 papers/plans/auth users/storage objects, DB 약 12.7MB |
| 로그인 화면 cloud browser | PASS | 실제 1440px 미리보기 렌더 |
| 실제 cloud browser PDF canary | PASS (기술 구조 범위) | 200dpi 재생성 후 text/annotations/attachments 0, JavaScript false. 수학적 누출 검토와 별도 |
| CI Chromium 전체 UI·독립 pypdf | NOT_RUN | 저장소 목적지 사용자 승인 완료. workflow 업로드 후 실행 예정 |
| 세 제공사 파일 어댑터 | PASS (모의 HTTP) | 별도 준비·multipart 정확 복원·handle·예산 해제·키/업로드 토큰 미노출. 실제 제공사 호출 0 |
| Google 팀 3계정·미초대·refresh | BLOCKED | 실제 OAuth 설정·팀원 2명 이메일·개별 로그인 필요 |
| Cloudflare Pages 실제 HTTPS | BLOCKED | Cloudflare 로그인 필요 |
| 실제 Storage TUS·대형 경계·cloud backup | NOT_RUN | 로컬 메모리 저장 검수와 구분 |
| 브라우저/PC 종료 후 cloud mock | BLOCKED | scheduler secret·Vault·cron 연결 및 실제 클라우드 검수 필요 |
| 실제 provider text/JSON/단계 | BLOCKED | API OFF·예산 $0·키 없음. 실제 유료 호출 0 |
| 실제 provider PDF | BLOCKED | 구현·모의 검수 완료, 실제 제공사 upload/expiry 검증 미수행 |
| 팀 수학적 누출 검토 | NOT_RUN | 팀의 실제 자료·승인 필요 |

로컬 스트레스는 무료 클라우드에서 7,200회 호출했다는 증거가 아니다. OAuth·실제 API·Cloudflare·클라우드 예약의 미수행을 성공으로 바꾸지 않는다. 워크플로 아티팩트와 후속 실제 클라우드 증거로 이 보고서를 갱신한다.

사용자가 지정 private 저장소로 최신 소스·마스터 프롬프트 업로드를 명시적으로 승인했다. 원격 저장 후 CI·배포를 이어간다. 기존 클라우드 자료는 보존한다.

추가 PASS: 100개 batch 원자 예약·101개/40MiB 초과 거절, 다른 workspace IDOR, API Auth/CORS, 수동 정정 시 원문 보존·새 attempt·실제 모델 호출 0.
