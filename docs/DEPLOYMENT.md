# 운영 배포

2026-10-24 기준. 새 구현의 기능 검수와 실제 계정·결제·OAuth 검수는 구분합니다.

## 준비된 대상

| 항목 | 값 |
|---|---|
| GitHub | `soullee0180-droid/tisiif-math-research-lab` (private) |
| Render | `My Workspace`, `tea-dbe1i1psrm7s73db9580` |
| Supabase | `bugnhvehtrsgehgnhlvm`, Singapore |
| 연구 공간 | `e466696f-8e70-4e50-8a5e-8ef6902515f1` |
| 관리자 Google 이메일 | `soullee0180@gmail.com` |
| 웹 | `lab-web`, Docker, `0.5c-512mb`, Singapore |
| 실행기 | `lab-worker`, 동일 Dockerfile·SHA, `1c-2g`, Singapore |
| 실행기 디스크 후보 | 20GB, `/var/backups/tisiif` |

운영 서비스 URL과 실제 계정 견적은 아직 확정되지 않았습니다. 현재 공개 가격표 기준 웹 $7 + worker $25 + 20GB 디스크 $5 = 월 $37 후보입니다. 세금·대역폭 초과·별도 workspace 요금·Supabase·모델 API 비용은 포함하지 않습니다. 실제 계정 견적과 사용자 승인을 확인해야 합니다. Render 플러그인은 worker·Blueprint 생성 기능을 제공하지 않으므로 실제 두 서비스 생성은 Blueprint Dashboard 또는 지원되는 CLI/API로 진행합니다. 서비스를 하나의 웹 프로세스로 합치지 않습니다.

## 최초 배포 순서

1. CI 성공 commit SHA와 `build-manifest.json`을 확인합니다. Dockerfile의 기본 이미지 digest를 검증 산출물과 대조합니다.
2. Render에서 연결된 GitHub App이 이 private 저장소에 접근하도록 허용합니다. 저장소를 public으로 바꾸거나 소스에 개인 토큰을 넣지 않습니다.
3. [Blueprint 생성](https://dashboard.render.com/blueprint/new?repo=https://github.com/soullee0180-droid/tisiif-math-research-lab)을 열어 두 서비스·Singapore·계획·디스크 견적을 검토합니다. 현재 계정의 유료 비용에 동의하기 전 Apply를 누르지 않습니다.
4. 아래 서버 비밀값을 Render의 안전한 입력란에 넣습니다. 채팅·스크린샷·GitHub에 넣지 않습니다. `SECRETS_MASTER_KEY`는 32바이트의 base64 인코딩이며 두 서비스가 같은 값을 공유해야 합니다. Blueprint의 `fromService`가 같은 값을 전달합니다.
5. 웹 pre-deploy에서 `python -m lab.cli migrate`를 한 번 실행합니다. SQL 적용 이력과 advisory lock으로 중복 실행을 방지합니다. worker에 migration을 중복 지정하지 않습니다.
6. 연구 공간과 기본 프로토콜·관리자 allowlist는 이미 준비했습니다. 일반 새 설치에서는 웹 shell에서 `python -m lab.cli bootstrap`을 실행합니다. 기존 allowlist를 환경 변수로 덮어쓰지 않습니다.
7. 최종 HTTPS origin을 `APP_ORIGIN`에 설정하고 Supabase Auth의 site URL·redirect URL을 `<origin>/auth/callback`로 등록합니다. Google OAuth consent/client secret은 서비스의 안전한 설정 화면에서 연결합니다.
8. 웹 healthz 200과 Google 첫 로그인을 확인합니다. 그 뒤 동일 승인 SHA로 worker를 시작하고 설정 → 운영의 heartbeat를 확인합니다.
9. 실제 Supabase Storage의 프로젝트 업로드 한도를 100MiB 이상으로 확인합니다. bucket이 100MiB를 선언해도 프로젝트 상한을 올리지 않으면 100MiB 파일을 받지 못합니다. 팀 자료 크기에 맞는 실제 Supabase 비용·보존 플랜도 확인합니다.
10. 관리자 → 팀원에서 나머지 두 팀원의 이메일을 추가합니다. 실제 로그인·서버 역할·공유 자료 접근을 각각 확인합니다.
11. 관리자가 실제 API 키·팀이 고른 모델 프로필·이용 자격을 설정합니다. 명시적으로 허가한 경우에만 제공사당 단일 합성 연결 검사를 실행합니다. 본실험은 별도 지시 없이 시작하지 않습니다.

## 안전한 입력이 필요한 값

| 키 | 입력 위치·조건 |
|---|---|
| `DATABASE_URL` | Supabase 공식 연결 정보. 장기 실행 서버의 연결 경로, `sslmode=verify-full&sslrootcert=system`. 실제 호스트·포트·비밀번호를 안전하게 입력 |
| `SUPABASE_SERVER_SECRET` | Supabase 서버 전용 secret. 브라우저에 노출 금지 |
| `SECRETS_MASTER_KEY` | 서버 암호화용 32바이트 base64. 별도 안전한 보관 |
| `SUPABASE_PUBLISHABLE_KEY` | 활성 publishable key. 서버 secret으로 대체 금지 |
| `SUPABASE_URL` | `https://bugnhvehtrsgehgnhlvm.supabase.co` |
| `DEFAULT_WORKSPACE_ID` | 위 연구 공간 UUID |
| `BOOTSTRAP_ADMIN_EMAIL` | 위 관리자 이메일 |
| `TEAM_EMAIL_ALLOWLIST` | 아직 확인하지 않은 동료 이메일을 임의로 넣지 않음 |
| `APP_ORIGIN`, `BUILD_SHA` | 실제 웹 HTTPS origin, 실제 승인 commit SHA |

## 갱신과 롤백

새 claim 중지 → 실행 중 응답 수집 → migration → 웹 → worker 순서로 같은 SHA를 배포합니다. 디스크를 가진 worker는 단일 instance이며 무중단 교체를 보장하지 않습니다. 코드 롤백과 DB/파일 복원은 별도입니다. migration hash가 달라지면 자동 적용하지 않고 중단합니다.

[현재 Render Blueprint 명세](https://render.com/docs/blueprint-spec) · [컴퓨트 계획](https://render.com/docs/compute-plans) · [디스크](https://render.com/docs/disks) · [환경 변수](https://render.com/docs/configure-environment-variables)
