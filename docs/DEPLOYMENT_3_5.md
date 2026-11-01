# 3.5 배포 순서

대상은 `free/v3-from-scratch` 계열이다. `main`의 다른 앱 구조에 migration을 섞지 않는다. GitHub 코드 반영과 Supabase/Pages 운영 적용은 별도 작업이다.

1. API 실행 및 기존 계획을 일시정지하고 DB와 Storage를 운영 도구로 백업한다. 기존 불명 요청을 자동 재전송하지 않는다.
2. **새 migration 두 개만** 순서대로 적용한다.
   - `20261029010000_reliability.sql`
   - `20261029020000_research_tasks.sql`
3. `api`, `execute`, `dispatch` Edge 함수를 같은 커밋에서 배포한다. 기존 `verify_jwt=false` 및 내부 HMAC/Vault 구성을 유지한다. `supabase/functions/deno.json`의 pdf-lib import도 포함한다.
4. 같은 커밋의 Vite 프런트엔드를 Pages에 배포한다. Git 자동배포가 연결된 경우 migration/Edge가 준비되기 전에 프런트엔드만 운영에 나가지 않도록 배포 순서를 관리한다.
5. 공개 화면의 서버 예산 상한을 확인한다. migration은 이미 저장된 제공사별 예산을 최초 상한으로 고정한다. 새 환경/미등록 제공사의 기본 상한은 0이다. 인가된 DB 관리자만 아래 값을 정할 수 있다.

```sql
-- 관리자가 workspace UUID와 승인한 금액으로 직접 실행. 공개 앱 경로로 실행하지 않는다.
insert into lab_private.server_budget_caps(workspace_id,provider,limit_usd)
values ('WORKSPACE_UUID'::uuid, 'anthropic', 8)
on conflict(workspace_id,provider) do update set limit_usd=excluded.limit_usd;
```

6. 기존 PDF 승인본에는 source/recipe 연결이나 서버 검수가 없을 수 있다. 기존 연구 기록은 그대로 남지만 **새 실험에는 새 버전에서 공개 PDF를 다시 생성·미리보기·승인**해야 한다. 새 파일을 생성해도 원본이나 과거 승인본을 삭제하지 않는다.
7. API 화면에서 기본 텍스트 예제로 키/모델/단가/예약 상한/TPM/예산을 점검한다. 제공사 실제 크레딧은 콘솔에서 확인하고 앱에 24시간 확인 기록을 저장한다. 유료 검증 네 단계 후 단일 모델의 작은 예비 실험을 실행한다. PDF와 ML 새 유형도 본실험 전에 별도 예비 실행한다.

새 기본 프롬프트나 JSON 스키마를 바꿀 때는 SQL의 신뢰 bundle 버전과 실행기 지원 버전을 함께 올린다. 기존 계획 snapshot을 수정하지 않는다. 미지원 실행 버전은 코드가 차단하므로 호환 실행 경로를 유지하거나 명시적으로 새 계획을 만든다.

롤백은 새 실행을 정지한 뒤 이전 프런트엔드/Edge를 복원하는 방식으로 한다. 신규 ML run/채점 데이터를 삭제하는 down migration은 제공하지 않는다. 이전 코드로 ML 계획을 실행하지 않는다. 기존 백업/복원 RPC는 legacy 구조용이며 새로운 ML 테이블까지 포함하는 전체 복구는 DB·Storage의 운영 백업을 사용한다.
