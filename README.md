# TISIIF Research Lab · 3.5

공개 공동 연구 공간: https://tisiif-math-research-lab.pages.dev

논문·분기점, 기존 수학 아이디어 실험, ML 실험설계 네 과제(생성·판별·앵커링·심사 검토), 수동/모의/API 실행과 독립 Excel 채점을 지원한다. 로그인은 없으며 등록 자료와 변경 내용은 공개된다. API 키 원문은 저장 후 표시하지 않는다.

API 설정 순서: 공동 키·예산 → 모델 프로필 → 기본 텍스트 예제 → 실행 전 점검 → 네 단계 검증 → 모델 사용. PDF는 별도 네 단계 검증이 필요하다. 단일 제공사 시험이 가능하며 기존 아이디어 실험의 상호 채점은 두 제공사 이상에서 수행한다. 모든 유료 호출에는 앱 예산과 공개 화면에서 올릴 수 없는 서버 상한이 적용된다.

- 변경 사항과 검토 항목 대응: [IMPLEMENTATION_20261029.md](docs/IMPLEMENTATION_20261029.md)
- 신규 migration과 적용 순서: [DEPLOYMENT_3_5.md](docs/DEPLOYMENT_3_5.md)
- 검증 기록: [TEST_REPORT_3_5.md](docs/TEST_REPORT_3_5.md)

```sh
npm ci
npm run check
npm test
npm run test:integration
npm run build
npm run bundle:edge
```

API 통합 테스트는 합성 입력·모의 HTTP를 사용한다. 실제 키의 성공 검증은 별도 opt-in 유료 시험이다. 전체 데이터 복구에는 DB·Storage 백업이 필요하며 연구 결과 ZIP을 전체 백업으로 취급하지 않는다. 기존 운영 DB를 reset하거나 이전 migration을 재적용하지 않는다.
