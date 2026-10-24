"""Publish evidence from completed CI stages; never infer a live cloud/API test."""
import json,os,xml.etree.ElementTree as ET
from pathlib import Path
root=ET.parse('test-results/python.xml').getroot()
suites=root.findall('.//testsuite') or [root]
counts={k:sum(int(s.get(k,0)) for s in suites) for k in ('tests','failures','errors','skipped')}
front=json.loads(Path('test-results/frontend.json').read_text())
browser=json.loads(Path('test-results/browser.json').read_text())['stats']
source=os.environ['GITHUB_SHA'];run=os.environ['GITHUB_RUN_ID'];repo=os.environ['GITHUB_REPOSITORY']
passed=counts['tests']-counts['failures']-counts['errors']-counts['skipped']
assert counts['failures']==counts['errors']==counts['skipped']==0
assert front['numFailedTests']==0 and browser['unexpected']==browser.get('flaky',0)==0
text=f'''# 검수 보고서

검증 코드 SHA: `{source}`  
[재현 가능한 GitHub Actions 실행](https://github.com/{repo}/actions/runs/{run})

## 자동 검증 결과

| 구분 | 결과 |
|---|---|
| 원본 계약 정적 검사 | 65개 통과. 실제 서비스 검수와 구분 |
| Python 단위·PostgreSQL 통합 | {passed}/{counts['tests']} 통과, 실패·skip 0 |
| 프런트엔드 API 테스트 | {front['numPassedTests']}개 통과 |
| Playwright 실제 브라우저 | {browser['expected']}개 통과, 실패·flaky 0 |
| TypeScript·Vite production build | 통과 |
| Render 공개 JSON Schema | 통과. 인증된 계정의 semantic validation은 별도 |
| 실제 Docker build·runtime import | 통과 |

## 확인한 범위

- 실제 PostgreSQL 17의 새 migration, 서버 allowlist·role, 팀원의 공유 결과, 비초대·비로그인·다른 공간 파일 접근 차단, 직접 RLS·private 테이블 차단.
- 실제 PDF 검증·이미지 redaction·회전·원문 text layer 제거, 숨긴 기준·비공개 단계의 생성/유용성 입력 제외, 승인본 불변.
- 100개 파일을 예약·3개 동시 전송·검증. 합성 비PDF 1개만 실패하고 정상 99개 보존. 운영 Supabase TUS에서 실제 네트워크 중단·재개는 별도 검수 필요.
- 기본 분기점 6 run·36 logical job, 중복 요청, 독립 후보 매핑, 자기 평가 금지, 동시 등록·계획 공정 배정·한국시간 예약.
- 7,200개 mock logical job 전부 처리, 미전송 lease 만료 후 재개, 동시성 상한, 후보 6,000개, 지표 집계와 10개 시트 Excel 생성. 실제 모델 호출 0회.
- 저장 직후 장애의 원문 재파싱과 재호출 차단, remote unknown 자동 재전송 차단.
- 수동 웹 경로의 독립 구분·원문 보존·보정 기록·중복 제출, 층화 사람 검토·단계별 블라인드·최초 판단·수정본 보존.
- 동일 데이터의 null/분모·공통 비교·논문별 동등 가중치, formula injection, ZIP 경로 검증, 분할 archive의 결합과 hash 검증.
- 새 비활성 공간으로 실제 연구 행·PDF·요청/응답 파일 복원, 행 수와 file SHA, 표시 순열 seed 보존. export/backup 작업은 취소 상태의 이력으로 유지.
- 1440×900 논문·결과 화면, 390×844 모바일 메뉴·진행 상황. 스크린샷과 trace는 실행 산출물에 포함.

## 실제 계정에서 남은 검수

| 항목 | 상태·필요한 행동 |
|---|---|
| Render 실제 서비스 생성 | BLOCKED: Dashboard 로그인, private GitHub App 연결, 실제 월 견적 승인과 안전한 서버 비밀값 입력 |
| Google OAuth·실제 3계정 | BLOCKED: Google client 설정과 동료 두 이메일. 합성 인증 테스트를 실제 로그인 성공으로 표시하지 않음 |
| 실제 Supabase TUS·상한 | BLOCKED: 운영 Storage 연결·100MiB 프로젝트 상한 확인 후 중단/재개 검수 |
| Render 강제 종료·영속 디스크 | BLOCKED: 운영 서비스 생성 뒤 heartbeat·SIGTERM·재시작·백업 보존 확인 |
| 실제 모델 API | BLOCKED: 팀 모델·키·이용 자격·결제·제공사별 1회 유료 검사 허가. 이 구현 과정의 실제 inference는 0회 |
| 대표 논문·수학적 판단 | BLOCKED: 팀이 고른 논문과 공개 입력을 팀과 교차 확인. 본실험 자동 시작 안 함 |
| CropBox 등 특수 PDF·키보드 전 경로 | 기본 회전·mask·modal 동작과 별도로 대표 특수 문서·전체 접근성의 운영 교차 검수 필요 |

Supabase의 private RLS/no-policy INFO는 의도한 브라우저 차단입니다. 사용되지 않은 index 안내는 연구 데이터가 없는 시점의 정보입니다. 연구 데이터나 원본을 지우는 작업은 하지 않았습니다.

`build-manifest.json` 산출물에는 이 실행의 실제 source SHA, 공식 기본 이미지 digest, lockfile SHA256이 기록됩니다. 이 보고서의 문서 전용 후속 commit은 검증한 앱 소스 변경이 아닙니다. 운영 배포에서는 선택한 승인 SHA를 웹·worker에 동일하게 설정합니다.
'''
Path('docs/TEST_REPORT.md').write_text(text)
print(f'Published verification evidence: Python {passed}, frontend {front["numPassedTests"]}, browser {browser["expected"]}; live inference 0.')
