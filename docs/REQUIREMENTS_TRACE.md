# 공개판 우선 요구

최신 사용자 요청은 `02_PUBLIC_ACCESS.md`입니다. 아래의 원본 master에서 Google 로그인·초대·역할 UI·3계정 검수 항목은 폐기되었습니다. 현재 구현은 로그인 없는 공용 편집이며 개인별 권한/검토자 UI를 제공하지 않습니다.

# 요구사항 추적

| 명세 | 구현·검수 위치 |
|---|---|
| F01 무료 조건 | FREE_TIER_LIMITS, 새 고정비 0 구조, 실제 조직 플랜 확인 |
| F02/F03 인증·IDOR | api/handler, lab_identity/actor, private schema grants, database integration. 실제 3계정 검수 BLOCKED |
| F04 불변성 | revision/plan/attempt/immutable triggers, SQL tests |
| F05/F06 업로드 | upload.ts TUS 6MiB, SQL batch atomic reservation/admission, server HEAD/hash. 실제 TUS 미검수 |
| F07 PDF | pdf.worker.ts raster/mask/new PDF + source canary + independent pypdf CI. CI 및 독립 pypdf PASS (d246ab3, run 40142289144); CropBox·회전·경계는 추가 실제 자료 검수 필요 |
| F08/F09 정보 차단·ID | contracts/core.ts, stage DTO unit canaries, mapping and semantic validation |
| F10~F14 queue·복구 | free_queue/scheduler, internal HMAC, execution/provider adapters, pipeline unknown/reparse; 실제 cloud 검수 별도 |
| F15 지표 | packages/metrics, M01~M04/equal paper/common/null unit |
| F16 사람 검토 | review_sample/review DTO/revisions, SQL blind-reference sequence, strata reliability UI |
| F17 수동 | execution.ts manual raw/metadata/mapping/correction; transport 분리 |
| F18 Excel·snapshot | lab analysis snapshots/pagination, workbook 10 sheets/formula/30k sidecar roundtrip |
| F19 백업·복원 | transfer Worker/Merkle/file hashes/UUID remap/inactive restoration; local DB+72 raw restore PASS, actual Storage 별도 |
| F20 secrets·XSS | AES-GCM/AAD unit, server-only keys, Markdown skipHtml/KaTeX trust false/CSP/CORS, internal nonce |
| F21 UI | Korean responsive 216px sidebar/64px header, real login preview, CI desktop/mobile test |
| F22 | local 7,200 jobs / 14,400 raw / no model calls PASS |
| F23/F24 | cloud short load and actual models require separate evidence; NOT_RUN/BLOCKED |

추가: provider-files.ts와 free_provider_files는 prepared hash 검수→공식 업로드→durable handle→다음 invocation 추론을 분리한다. 모의 HTTP 7요청에서 실제 제공사 호출 0, 비밀 미노출을 확인했다.
