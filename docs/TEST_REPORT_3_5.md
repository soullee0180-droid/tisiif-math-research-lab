# 3.5 검증 기록 · 2026-10-29

대상: `free/v3-from-scratch`의 `2789991`을 기준으로 한 `fix/research-reliability-20261029`. 아래 결과는 격리된 로컬 환경에서 확인했다. 운영 배포나 실제 유료 API 성공을 뜻하지 않는다.

| 검사 | 결과 |
| --- | --- |
| TypeScript `npm run check` | 통과 |
| Vitest `npm test` | 6개 파일, 48개 테스트 통과 |
| `npm run test:integration` | 8개 스크립트 통과 (PGlite PostgreSQL) |
| Prettier 검사 | 대상 TypeScript/TSX 전부 통과 |
| Vite production build | 통과; 기존 대형 번들 경고 있음 |
| Edge 3개 함수 bundle | 통과 |
| Deno `check --frozen` | 통과 |
| Playwright | 5개 시나리오 통과 |
| 독립 `pypdf` 공개 PDF 검사 | 통과 |
| 7,200 작업 부하 시험 | 전부 완료, 원문 객체 14,400개, 계획별 3,600개, 실제 외부 호출 0회 |

## 직접 재현한 회귀 시나리오

- 짧은 Claude 텍스트가 0.5 USD 요청 상한과 TPM 사전 점검을 통과한다.
- 401 거절은 검증 실패로 표시되고 예약액이 반환된다. 네트워크/원격 처리 불명은 자동 재전송하지 않는다.
- 응답 저장 후 DB 완료 실패를 재파싱으로 복구한다. 추가 모델 호출 및 이중 정산이 없다.
- 정상 JSON이어도 출력 제한 종료는 실패로 분류한다. 알려진 사용량은 정산한다.
- Google thoughts/캐시, Anthropic 캐시 읽기·생성, OpenAI reasoning/cache를 제공사별로 계산한다. 단가가 없는 사용량은 0으로 간주하지 않는다.
- 공개 API가 서버 예산 상한과 핵심 요청 파라미터를 바꿀 수 없다.
- PDF recipe 변경 시 기존 공개본 참조가 무효화된다. 실제 브라우저에서 숨은 텍스트·주석·JS·첨부가 있는 PDF를 raster 공개본으로 만들고 별도 파서로 검사했다.
- 네 가지 ML 과제와 A/B 순서 교환, 정상/결함 앞 단계가 별도 run으로 완료된다. 비공개 정답 근거·rubric·리뷰 근거가 생성 입력에 들어가지 않는다.
- 두 검토자의 최초 판정, 사유 있는 수정, 합의를 별도 보존한다. 기존 수학 idea의 독립 Excel 채점 가져오기도 확인했다.
- 분석 계획 범위, 계산 버전, 저장 snapshot hash가 일치한다. 서로 다른 계획의 불완전한 반복을 합치지 않는다.
- `research.xlsx`와 검토자별 Excel을 브라우저에서 실제 다운로드했다. 외부 공유 ZIP의 작은 파일명이 원형으로 유지되고 비공개 기준·검토자 기록이 제거된다. 파생 점수는 유지된다.
- 390px 모바일에서 문항·두 모델 비교·ML 결과 화면의 가로 넘침을 검사했다.

## 실행 환경과 남은 운영 확인

브라우저 시험은 Chromium 141 headless에서 실행했다. 설치된 Playwright의 기본 Chromium 다운로드가 CDN에서 실패하여 실행 파일 경로를 명시했다. PDF는 legacy 배포본의 호환 polyfill을 사용하며, Vite 개발 서버의 동적 의존성 재최적화로 인한 페이지 재시작도 방지했다.

로컬 Docker가 없어 `postgres_concurrency.py`의 **별도 PostgreSQL 컨테이너 경합 시험은 미실행**이다. GitHub Actions에는 PostgreSQL 17 서비스와 해당 검사를 유지했다. PGlite 검사는 실제 여러 연결의 경합 시험을 대체하지 않는다.

실제 제공사 호출은 **0회**, 운영 DB/Storage 변경 및 사이트 배포도 **0회**다. 실제 키·크레딧·모델 접근, PDF 제공사 업로드, 각 ML 과제의 실제 모델 출력 적합성은 배포 후 작은 예비 실행으로 확인해야 한다. `docs/DEPLOYMENT_3_5.md`에 적용 순서와 opt-in 유료 검증 경로가 있다.
