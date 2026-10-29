> 과거 버전 기록입니다. 3.5의 현재 구현·운영은 [IMPLEMENTATION_20261029.md](IMPLEMENTATION_20261029.md)와 [DEPLOYMENT_3_5.md](DEPLOYMENT_3_5.md)를 우선합니다.

# 공개 API·최소 입력 3.2 검수

- TypeScript, 단위 33개, SQL, 36-job/72-raw pipeline, shared API integration, production build PASS. 논문 metadata와 reference_location 없이도 fixture를 승인해 전체 실행했다.
- 공동 API integration: 암호화/원문 미반환, 12개 멱등 capability probes와 18개 API-wire jobs, 단계별 immutable prompt와 anon 직접 RPC 거절 PASS. HTTP는 모의이며 실제 제공사 호출은 0회다.
- Supabase api v6, dispatch/execute v4 ACTIVE. Vault/cron 설치와 원문 위치 선택 migration 적용. 실제 공개 API에서 서명된 dispatch HTTP 200 accepted. gateway가 줄인 경로와 원래 경로 모두 HMAC 검증하며, 재사용 nonce·변조 본문·다른 함수 경로는 거절한다.
- Cloudflare Pages commit 315a9aa 배포 check 성공. 실제 공개 사이트에서 PDF만 선택하는 등록 화면, 제목만 표시되는 정보 수정과 접힌 선택 관리 정보, 핵심 4항목의 분기점 편집, API 설정·단계 전환 확인. 기존 논문·분기점·자료 보존.
- 신규 네 단계 프롬프트 UI의 접근성 label에 안내 문구가 섞여 E2E가 실패했던 문제를 명시적인 textarea aria-label로 수정. 전체 CI **40186527443 PASS**: 실제 PostgreSQL 동시성·7,200 mock jobs·E2E 세 시나리오·390px 모바일·PDF Worker·독립 pypdf 검수까지 통과.
- 현재 등록 키 0개, API OFF, 제공사 예산 $0. 실제 모델 성공·실제 PDF 제공사 업로드·브라우저 종료 후 실작업 완료는 아직 검증하지 않았다. 실키는 사용자가 사이트의 password 입력란에 직접 등록해야 한다.

아래는 과거 버전의 검수 기록이며, 현재 상태는 위 기록과 DEPLOYMENT_LEDGER.json을 따른다.

# 공개판 3.1 검수

- TypeScript, 단위 32개, 기존 SQL와 36-job pipeline 통과.
- 새 public-access integration: 무인증 공유 actor, 공용 작성, idempotency, 위조 actor/workspace 무시, 관리 endpoint 차단, anon 직접 RPC 차단, 18 mock jobs / 36 raw files, 모델 네트워크 0, 요청 한도 429 통과.
- 실제 Supabase: API v4 ACTIVE, 공개 migration 적용, Google identity 함수 제거, 제공사 예산 $0·OFF, 무인증 /me·papers 200, settings 403, CORS * 확인.
- 실제 cloud-browser에서 새 UI가 실제 Supabase의 빈 논문 목록을 인증 없이 표시함을 확인. 상단 네 메뉴·흰 배경이며 Google/초대/계정/사이드바 화면 없음.
- Supabase REST에서 사용량 UPDATE의 WHERE 누락 오류(21000)를 발견하고 singleton WHERE로 수정. SQL 직접 호출만으로 검수 완료를 주장하지 않음.
- 전체 GitHub CI **40147864591 PASS** (source 21bb701): 실제 PostgreSQL 17 동시성, 7,200 mock logical jobs/14,400 raw, build/Deno, 무인증 수동 UI·390px 모바일·PDF Worker/독립 pypdf 검수 포함.
- Cloudflare Pages **https://tisiif-math-research-lab.pages.dev** production branch free/v3-from-scratch, source 21bb701 배포 완료를 Dashboard와 실제 사이트에서 확인. 새로고침·논문·계획·큐·분석 모두 로그인 없이 정상.
- 실제 무인증 paper_create 200 후 점검용 paper만 정확한 ID/title/metadata 조건으로 정리했고 audit는 보존. 빈 mock step 200, real_provider_calls 0.
- 실제 TUS 및 별도 운영 설정을 필요로 하는 브라우저 종료 후 cron은 추가 검수 대상.

아래는 이전 비공개판의 회귀 검수 기록입니다. Google 3계정·이메일 초대 검수는 새 공개판의 요건이 아닙니다.

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
| CI Chromium 전체 UI·독립 pypdf | PASS | commit 2f2ad4e3251be81e4b8876186fbb03b658b5f664, Actions run 40134336764. 데스크톱·390px·prepared 다운로드·독립 pypdf 통과 |
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

실제 PostgreSQL 17 격리 CI PASS: 32개 동시 claim 중 1개 할당, 24개 멱등 요청은 같은 1개 행, nonce 1회, 2명 소유자의 공정 전환, RPM/TPM 차단, 8개 동시 100MiB 예약 중 7개 허용·800MB 미만. 실제 클라우드 부하와 구분한다.

Supabase 배포는 진행 중이다. 기존 schema는 legacy 이름으로 보존했고 schema 및 읽기 RPC까지 적용했다. 쓰기 RPC는 배포 도구의 긴 요청 오류 때문에 기능별 내부 함수로 분리했으며 SQL·36-job 전체 파이프라인 로컬 검수는 다시 통과했다. 이 분리 버전의 CI와 남은 실제 배포 상태를 후속 갱신한다.


후속 검수 commit d246ab3a62f5f734c8ea2ee733ced304dcb9f805 / CI run 40142289144: 전체 PASS. 내부 쓰기 함수 분리 후 실제 PostgreSQL 경쟁·7,200 mock·전체 UI·독립 PDF 파서를 다시 통과했다.

실제 Supabase 배포 PASS (배포 범위): 기존 28개 표를 legacy schema에 보존하고 새 업무 DB, 4개 private bucket, server-only RPC, scheduler 함수·확장, api/dispatch/execute v1을 적용했다. 관리자 allowlist는 확인된 1명만, API OFF·3개 예산 $0·scheduler OFF다. 전체 원격 migration ledger는 DEPLOYMENT_LEDGER.json에 있다. MCP로 나누어 적용했으므로 로컬 migration timestamp와 원격 version을 혼동해 재적용하지 않는다.

실제 HTTPS 검사 PASS: health 200 / 미인증 me 401 / 잘못된 Origin 403 / 서명 없는 dispatch·execute 403. 로컬 HTTP와 프로젝트 pg_net에서 동일 결과를 확인했다. 실제 모델 호출 0. 모든 새 업무 표 RLS ON, anon/authenticated 업무 RPC EXECUTE 0, DB 약 14.9MB. 보안 advisor는 WARN/ERROR 0, INFO 45개(서버 전용 private 표에 직접 사용자 정책을 두지 않은 의도된 설계)다.

아직 BLOCKED: Cloudflare Pages 공개 주소, Supabase secrets·Google OAuth 설정, 팀 3계정 실제 로그인, 실제 TUS·예약 mock·Storage 백업/복원. 예약 함수 설치는 완료했지만 secret과 사용자 검수가 없어 cron job은 0개이며 OFF다. 실제 provider capability는 예산·키 없이 BLOCKED로 유지한다.
