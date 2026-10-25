# 무료 한도

인프라 월 고정비 목표 $0. 모델 API 추론 요금은 별도이며 기본 허용 예산 $0.

| 항목 | 앱 보수적 한도 |
|---|---|
| 원본 / 배치 | 40MiB / 100개·합계 200MiB |
| 공개 PDF | 200dpi RGB, 32MiB·30쪽 |
| 파일 처리 | 업로드 3병렬, PDF 1개씩 |
| Storage | 주의 700MB, 신규 예약 차단 800MB |
| DB | 주의 350MB, 신규 작업 차단 400MB |
| 월 egress 추정 | 주의 3.5GB, 신규 작업 차단 4GB |
| 월 Edge 호출 추정 | 주의 350,000, 신규 작업 차단 400,000 |
| 공개 요청 | 전체 읽기 600/분 · 쓰기 60/분 |
| 제공사 동시성 | 각 1, 총 3 |
| API timeout / 목표 | 100초 / 실행 전체 120초 |
| lease / heartbeat | 90초 / 15초 |

2026-10-24 공식 문서 기준 Free Edge는 메모리 256MB·CPU 2초·wall 150초. Supabase Free DB 500MB·Storage 1GB·일반 egress 5GB·cached egress 5GB·월 Edge 500,000회, 1주 비활동 뒤 일시중지 가능. Pages Free는 월 500빌드·개별 정적 자산 25MiB. 조직 공유 할당량을 별도로 확인해야 하며 앱 추정치를 공식 잔량으로 표시하지 않는다.

이번 연결 조직은 `free/tier_free`로 확인했다. 다른 앱 소비분의 실제 조직 대시보드 검수는 별도다. 플랜 변경·카드 등록·추가 유료 상품은 실행하지 않는다. 장시간 추론·상시 자동 디스크 백업·무중단 SLA를 보장하지 않는다.

공식 근거: https://supabase.com/pricing · https://supabase.com/docs/guides/functions/limits · https://supabase.com/docs/guides/storage/uploads/resumable-uploads · https://developers.cloudflare.com/pages/platform/limits/
