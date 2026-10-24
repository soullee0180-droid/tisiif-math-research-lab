# 다음 작업 상태 (2026-10-24)

목표는 master v3에 따른 무료 앱 전체 구현·검수·배포다. 다시 처음부터 삭제하지 말고 이 인계 소스를 계속 사용한다.

- 최신 소스는 이 인계본이다. GitHub 무료판 브랜치 `free/v3-from-scratch`의 현재 저장 head는 `9b62658fd38bb16e9e8194a6acbed9f52b2a7b98`이고 최신 전체 구현이 아직 올라가지 않았다. main은 이전 코드다.
- 사용자가 최신 소스와 마스터 프롬프트를 `soullee0180-droid/tisiif-math-research-lab` private 저장소에 업로드하는 것을 명시적으로 승인했다. 같은 목적지에 새 tree/commit을 쓰고 expected SHA lease로 무료판 브랜치를 갱신한다. 이전 업로드 승인 차단은 해소됐다.
- GitHub Primary link: `link_6ac85796c440819182c66af311481f5a`. 다른 조직 계정과 섞지 않는다.
- Supabase 연구 프로젝트: `bugnhvehtrsgehgnhlvm`, 조직 `ckdplgeglvvjwulwecro`, Free 확인됨. 이전 schema/history/advisor와 빈 연구 자료·Storage를 확인했다. **이 인계 소스의 새 migration은 아직 실제 프로젝트에 적용하지 않았다. Edge도 배포하지 않았다.** 기존 cloud data는 보존한다.
- 관리자 확인 이메일: `soullee0180@gmail.com`. 다른 두 팀원은 미확인. 임의 계정으로 대체하지 않는다.
- 검수는 TEST_REPORT를 본다. CI 파일은 작성됐으며 승인된 소스 업로드 후 workflow를 실행한다. 이후 CI, 실제 Postgres 병렬 경쟁, 전체 desktop/mobile UI, 독립 pypdf, cloud TUS·예약·복원을 완료한다.
- 무료 인프라만. 실제 모델 키·master/scheduler secret은 배포 보안 설정에서 주입하며 소스에 넣지 않는다. API OFF·모든 예산 $0. 실제 제공사 호출 0. 실제 text/PDF·각 단계 capability 검수는 사용자 예산 허용 전 BLOCKED다.
- source/prepared/raw/archives는 private. master 14개 계약을 첨부 원본에서 추출했고 런타임은 새로 작성했다. 배포 전 새 migration 검수·빈 상태 bootstrap을 수행한다. 공개 schema에 business tables를 노출하지 않는다.
- Cloudflare 플러그인 없음. 공식 Dashboard에 로그인 필요. Cloud Browser는 실제 로그인되지 않았다. 브라우저 인증은 browserAuth로 처리하고 비밀을 채팅으로 받지 않는다. Render 로그인 경로는 사용하지 않는다.
- 로컬 미리보기는 Sites managed preview CLI를 사용한다. 별도 서버/브라우저 우회 없이 반환된 URL을 CUA로 연다. 실제 PDF canary 구조 PASS는 확인했지만 브라우저 파일 내려받기/화면 증거 저장 중 연결 오류가 발생해 독립 parser 확인은 CI에서 이어간다.
