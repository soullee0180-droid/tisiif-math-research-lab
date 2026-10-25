# TISIIF Math Research Lab · 3.2

사이트: https://tisiif-math-research-lab.pages.dev

로그인 없이 사용하는 공개 공동 연구 공간입니다. 논문·분기점·수동/모의/API 실험을 관리합니다. Google 계정이나 초대가 필요하지 않습니다. 모든 방문자가 자료와 공동 API 키의 실행 권한을 공유합니다.

**API·프롬프트**에서 키·예산 → 모델 등록 → 4단계 실제 검증 → 모델 사용을 설정하고 실험 계획을 시작합니다. 기본 API 스위치는 OFF, 예산은 $0이며 키 원문은 저장 후 표시하지 않습니다. 모델 검증은 실제 요청 4회와 승인 입력을 사용합니다. 세 제공사의 검증 모델이 준비되어야 정식 비교 실험을 만들 수 있습니다. PDF는 별도 검증이 필요합니다.

생성·선택·유용성·일치도별 추가 지시를 편집할 수 있고, 실험별 설정이 불변 snapshot으로 저장됩니다. 서버 cron이 자동 실행하므로 브라우저를 닫아도 진행됩니다. 키가 없는 상태에서는 실제 호출이 발생하지 않습니다.

최신 명세 [03_SHARED_API.md](03_SHARED_API.md)가 이전 [02_PUBLIC_ACCESS.md](02_PUBLIC_ACCESS.md)의 API 차단 조건을 대체합니다. 무료 인프라 목표는 $0이며 실제 모델 요금은 제공사 계정에서 별도로 청구됩니다.

검수: npm run check / npm test / npm run test:sql / node --import tsx tests/integration/shared-api.ts / npm run build / npm run bundle:edge. 배포는 docs/DEPLOYMENT.md, 실제 적용 이력은 docs/DEPLOYMENT_LEDGER.json을 참고하세요. 기존 DB를 reset하거나 전체 migration을 재적용하지 않습니다.
