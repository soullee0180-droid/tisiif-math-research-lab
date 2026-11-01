> 과거 버전 기록입니다. 3.5의 현재 구현·운영은 [IMPLEMENTATION_20261029.md](IMPLEMENTATION_20261029.md)와 [DEPLOYMENT_3_5.md](DEPLOYMENT_3_5.md)를 우선합니다.

# 현재 배포 · 공동 API 3.2

Cloudflare Pages Free + Supabase Free. 사이트 https://tisiif-math-research-lab.pages.dev, production branch free/v3-from-scratch, build `npm ci --ignore-scripts && npm run build`, output apps/web/dist, Node 24.

신규 migration은 shared_api와 shared_api_scheduler_secrets 두 개입니다. 기존 migration을 재적용하거나 DB reset하지 않습니다. shared_api의 새 RPC·기존 queue/plan 함수 수정 후 api/dispatch/execute를 배포하고 Vault/cron 설정 migration을 적용합니다. Edge 3개는 자체 HMAC/공개 action 검사에 따라 verify_jwt=false입니다.

서버는 LAB_SECRETS_MASTER_KEY/LAB_SCHEDULER_SECRET 환경 값이 있으면 사용하고, 없으면 고정 이름의 Vault 값으로 대체합니다. 이번 프로젝트는 Vault를 초기화하고 1분 cron을 설치했습니다. 값을 화면·로그·Git에 노출하지 않습니다. 일반 이용자는 Google OAuth나 서버 비밀을 설정하지 않습니다.

/api-settings에서 공동 키·정확한 모델 ID·공식 토큰 가격·요청 예약 비용·누적 예산·제공사 호출 허용을 입력합니다. 전체 API 스위치를 켜고, 승인 분기점으로 모델당 네 단계 실제 검증을 예약합니다. PASS 후 모델 사용을 누르고 API 실험을 만듭니다. 최초 $0/OFF 상태를 사용자 동의 없이 유료 예산으로 바꾸지 않습니다.

기본 RPM 5/TPM 100,000/간격 15초입니다. PDF와 긴 입력은 제공사 콘솔에서 확인한 실제 호출 한도를 설정하세요. 모델 키와 API 잔액이 없으면 실제 실행 검수는 BLOCKED로 기록합니다.
