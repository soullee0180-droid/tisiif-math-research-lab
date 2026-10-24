# TISIIF Math Research Lab

공개 연구 맥락에서 다음 아이디어를 생성·선택하고, 다른 두 제공사가 유용성과 논문 아이디어와의 일치도를 독립적으로 평가하는 공동 연구 앱입니다. Railway 없이 Render 웹·실행기와 Supabase Auth·PostgreSQL·private Storage를 사용합니다.

이 저장소의 앱 코드는 마스터 프롬프트 v2.0에 따라 새로 작성했습니다. 실제 연구 자료와 API 결과는 들어 있지 않습니다. 테스트의 `fixture` 자료는 합성 응답이며 실제 모델 검수의 증거가 아닙니다.

## 현재 배포

- 소유자: `soullee0180-droid`, 관리자 Google 계정: `soullee0180@gmail.com`
- [Supabase 프로젝트](https://supabase.com/dashboard/project/bugnhvehtrsgehgnhlvm): 스키마, private 버킷, 관리자 허용 목록, 기본 프로토콜 준비.
- Render 공간: `My Workspace` (`tea-dbe1i1psrm7s73db9580`). 웹과 실행기는 아직 생성하지 않았습니다.
- 운영 URL: 아직 없음. 결제 견적 확인, 안전한 서버 비밀값 입력, Google OAuth 연결이 남아 있습니다.
- [Render Blueprint 열기](https://dashboard.render.com/blueprint/new?repo=https://github.com/soullee0180-droid/tisiif-math-research-lab)

[배포 절차](docs/DEPLOYMENT.md) · [운영 절차](docs/OPERATIONS.md) · [검수 보고서](docs/TEST_REPORT.md) · [구현 결정](docs/DECISIONS.md) · [전체 원본 명세](01_MASTER_PROMPT.md)

## 사용 흐름

1. 승인된 Google 계정으로 로그인합니다. 관리자가 설정 → 팀원에서 동료의 Google 이메일을 추가합니다.
2. 논문 → PDF 등록: 배치당 100개·합계 1GiB, 파일당 100MiB까지입니다. 파일 선택·전송 뒤 서버가 실제 PDF를 검증합니다. 운영 Supabase 프로젝트의 실제 업로드 상한도 100MiB 이상으로 설정해야 합니다.
3. 논문 → 분기점: 공개 목표·장애·단계, 숨길 기준 아이디어와 위치를 입력합니다. PDF 영역을 가리고 실제 전송 미리보기를 확인한 뒤 승인합니다. 승인된 입력은 수정할 수 없으며 새 버전으로 복제합니다.
4. 설정에서 팀이 고른 실제 모델 프로필과 API 키를 등록합니다. 모델 목록 조회와 실제 연결 검사는 별개입니다. 연결 검사 버튼은 합성 입력으로 실제 요청 1회를 보냅니다.
5. 실험 만들기: 승인된 분기점·세 제공사 프로필·프로토콜을 선택합니다. 기본값은 후보 5개, 독립 반복 2회이며 분기점 하나당 6 run·36 논리 단계입니다. 처음에는 예비실험으로 검수합니다.
6. 결과에서 동일 조건 그룹을 비교하고 엑셀 다운로드를 누릅니다. 내보내기는 저장된 응답으로 계산하며 AI 요청을 추가하지 않습니다. 긴 본문과 분할 파일이 표시되면 함께 보관합니다.
7. 오류는 진행 상황 → 해당 단계 → 오류에서 job ID·시도·요청/응답 원문을 확인합니다. `unknown_remote`는 중복 과금 가능성을 확인한 뒤 명시적으로 재시도합니다.

## 개발과 검증

Python 3.12, Node 24, PostgreSQL 17을 사용합니다. 의존성은 `uv.lock`과 `apps/web/package-lock.json`으로 고정합니다.

```bash
uv sync --frozen
cd apps/web
npm ci
npm run generate-types
npm run test
npm run build
cd ../..
python -m lab.cli migrate
python -m lab.cli bootstrap
python -m lab.cli web
# 별도 터미널
python -m lab.cli worker
```

환경 변수는 `.env.example`과 `contracts/env-contract.json`을 확인합니다. 운영에서 로컬 인증·로컬 Storage 테스트 옵션은 사용할 수 없습니다. 테스트 DB 준비 스크립트는 이름이 `tisiif_test`인 격리 DB에서만 실행됩니다. 실제 Supabase 시스템 테이블을 테스트용 스텁으로 바꾸지 마세요.

```bash
uv run python scripts/check_spec.py
uv run pytest -q tests
```

GitHub Actions는 실제 PostgreSQL 서비스, 브라우저, 프로덕션 Docker 이미지까지 검증합니다. OpenAPI에서 프런트엔드 타입을 생성하고, 이미지 digest와 lockfile hash를 빌드 산출물에 남깁니다. 최종 검수 결과와 실제 계정에서 차단된 항목은 검수 보고서에 구분합니다.
