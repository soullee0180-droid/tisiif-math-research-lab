# 구현 결정

- 무료판 런타임을 전부 새로 작성했다. 이전 소스는 Git 이력에만 남으며 신규 실행 경로에 사용하지 않는다. 연구 프롬프트·schema·fixture는 사용자 첨부 원본에서 추출했다.
- 작업 환경 초기화로 미저장 파일이 사라졌고, master 원본을 복구해 재작성했다. 이후 GitHub 무료판 브랜치에 중간 소스를 지속 저장한다.
- `lab`/`lab_private`는 미노출 private 업무 schema다. fixed RPC만 service_role에 허용하고, Edge Auth와 DB actor/workspace 검사로 이중 확인한다. 직접 anon/authenticated 업무 접근은 없다.
- 승인·결과·원문·최초 판단 불변성을 DB가 지킨다. 제공사별 전역 runtime을 먼저 잠그고 예산·job 순서로 claim한다. fairness timestamp를 별도 private 테이블에 두어 7,200개 검수에서 발견한 상관 서브쿼리 병목을 제거했다.
- 무료 Edge에서 대형 PDF/Excel/ZIP을 만들지 않는다. PDF.js/pdf-lib와 export Worker·IndexedDB 파트 다운로드를 사용한다.
- 백업은 실제 파일을 포함하며 한 번에 전체 Storage를 메모리에 중복 적재하지 않는다. 파일은 8MiB chunk, ZIP은 약 16MiB 파트로 나눈다. 로컬 검수 뒤 새 비활성 공간에만 복원한다.
- 공식 세 제공사 file handle 업로드·재사용·만료 재검수와 별도 준비 단위를 구현하고 모의 HTTP로 검수했다. 실제 제공사 PDF 검수 전에는 capability gate로 차단한다. 이를 텍스트 OCR이나 다른 모델로 조용히 대체하지 않는다. 수동 경로에는 승인 공개 PDF를 전달할 수 있다.
- 실제 OAuth 3계정·클라우드 예약·TUS·모델 검수는 로컬 mock 검사와 구분한다. 필요한 로그인·비밀·예산이 없으면 해당 항목만 BLOCKED/NOT_RUN으로 남긴다.
