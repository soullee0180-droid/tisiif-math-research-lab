# 이어서 할 작업 (2026-10-24)

전체 재삭제·재구축을 하지 말고 현재 v3 소스에서 계속한다. 사용자는 지정 private GitHub 저장소 업로드를 명시적으로 승인했다. Primary 계정 link_6ac85796c440819182c66af311481f5a, 저장소 soullee0180-droid/tisiif-math-research-lab, 브랜치 free/v3-from-scratch를 사용한다. main은 아직 이전 소스다.

commit 2f2ad4e3251be81e4b8876186fbb03b658b5f664에서 전체 CI run 40134336764가 PASS였다. unit·embedded PostgreSQL·실제 PostgreSQL17 동시성·7,200 logical mock·빌드·Edge 번들·Deno·1440/390px UI·PDF 실제 Worker 및 독립 pypdf까지 통과했다. 실제 provider 호출은 0이다.

현재 쓰기 RPC를 기능별 private 함수로 나눈 추가 변경이 있다. 긴 단일 SQL 요청이 Supabase 도구에서 Invalid or expired requestState로 실패하여 기능과 검수 가능성을 유지하는 작은 DDL로 나눴다. 원래 DB 전체 검수 및 36 jobs + 72 raw + inactive restore는 추가 변경 후 다시 PASS했다. 이 버전의 CI를 확인한다.

Supabase bugnhvehtrsgehgnhlvm, 조직 ckdplgeglvvjwulwecro, Free 확인. 기존 자료는 papers/plans/auth/storage 모두 0이었고 이전 lab/lab_private는 lab_legacy_v2/lab_private_legacy_v2로 보존됐다. 이미 적용한 원격 migration: v3_free_schema (20261024203828), v3_free_api_read (20261024230029). 전체 api 파일을 재적용하지 않는다. 현재 helper DDL과 wrapper를 순서대로 적용한 뒤 queue/research_tools/scheduler/admission/capability_probe/provider_files를 이어 적용한다. list_migrations와 실제 함수 존재를 먼저 확인해 중복 적용하지 않는다. 로컬 파일과 원격 버전 이름은 MCP 경로에 맞춰 별도 ledger로 기록한다. reset·db push를 실행하지 않는다.

아직 seed와 Edge 배포는 하지 않았다. 확인된 관리자 soullee0180@gmail.com만 bootstrap한다. 다른 팀원 2명 이메일은 미확인. API OFF·예산 $0·scheduler OFF로 시작한다. 비밀/인증/기존 cloud data는 삭제하지 않는다.

Cloudflare Pages Free + Supabase Free만 사용. Railway·Render·유료 서비스·카드 입력은 없다. 실제 모델 키·master/scheduler secret은 소스나 공개 환경에 넣지 않는다. Supabase 도구는 Edge secrets와 Auth config 설정 기능이 없어 Dashboard 인증이 필요하다. Cloudflare 플러그인도 없어 Dashboard 로그인 필요. 브라우저 로그인은 browserAuth를 사용하며 비밀을 채팅으로 받지 않는다.

실제 Google3계정·TUS·cloud backup·PC 종료 뒤 cron mock·실제 provider 검수는 CI 결과와 구분해 BLOCKED/NOT_RUN으로 기록한다. 무료 예산 허용 전 모델을 실제 호출하지 않는다. managed preview URL을 CUA로 검수하며 별도 브라우저 우회를 만들지 않는다.
