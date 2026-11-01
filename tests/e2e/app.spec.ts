import { unzipSync } from "fflate";
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
test("public paper without credentials, approved revision, manual plan and mobile UI", async ({
  page,
}) => {
  await page.goto("/papers");
  await expect(
    page.getByRole("heading", { name: "논문과 분기점", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Google|로그인|로그아웃/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "설정", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "논문과 분기점", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "논문 추가", exact: true }).click();
  await page
    .getByLabel("논문 제목", { exact: true })
    .fill("CI synthetic paper");
  await page.getByRole("button", { name: "논문 만들기" }).click();
  await page.getByRole("button", { name: "분기점 추가", exact: true }).click();
  await page.getByLabel("분기점 제목", { exact: true }).fill("CI checkpoint");
  await page.getByRole("button", { name: "공개 입력 작성" }).click();
  await page.getByLabel("목표", { exact: true }).fill("Public goal");
  await page.getByLabel("막힌 지점", { exact: true }).fill("Public obstacle");
  await page
    .getByLabel("공개 Markdown · LaTeX", { exact: true })
    .fill("Let x be a finite set.");
  await page.getByLabel("기준 아이디어", { exact: true }).fill("SECRET_CANARY");
  await page.getByRole("button", { name: /초안 저장/ }).click();
  for (const label of [
    "공개 입력을 확인했습니다.",
    "숨긴 기준이 전송 자료에 남지 않았습니다.",
    "일치도 평가에 사용할 기준 아이디어를 확인했습니다.",
  ])
    await page.getByLabel(label, { exact: true }).check();
  await page.getByRole("button", { name: "이 버전 승인" }).click();
  await expect(page.getByText("승인됨", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "실험 계획", exact: true }).click();
  await page.getByRole("button", { name: "새 실험 계획" }).click();
  await page
    .getByLabel("실행 경로", { exact: true })
    .selectOption("manual_web");
  await page.getByLabel("후보 수 K", { exact: true }).fill("1");
  await page.getByLabel("독립 반복 R", { exact: true }).fill("1");
  await page.getByRole("checkbox", { name: /CI synthetic paper/ }).check();
  await page.getByText("예약·단계별 추가 프롬프트", { exact: true }).click();
  await page
    .getByLabel("아이디어 생성 추가 지시", { exact: true })
    .fill("CI_CUSTOM_GENERATE_ONLY");
  await page.getByRole("button", { name: "일시정지 상태로 계획 생성" }).click();
  await page.getByRole("button", { name: "시작·재개" }).click();
  await page
    .locator(".job-grid article")
    .filter({ has: page.getByText("generate", { exact: true }) })
    .first()
    .getByRole("button", { name: "프롬프트·응답" })
    .click();
  await page.getByText("전달 내용과 mapping 확인").click();
  await expect(page.locator("[role=dialog] pre").first()).not.toContainText(
    "SECRET_CANARY",
  );
  await expect(page.locator("[role=dialog] pre").first()).toContainText(
    "CI_CUSTOM_GENERATE_ONLY",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator("body")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
test("image-only PDF removes hidden text, annotations, JavaScript and attachments", async ({
  page,
}) => {
  page.on("console", (msg) =>
    console.log("PDF browser", msg.type(), msg.text()),
  );
  page.on("pageerror", (error) => console.log("PDF pageerror", error.message));
  await page.goto("/__pdf.html");
  await page.locator("#source").setInputFiles("tests/fixtures/pdf-canary.pdf");
  await page.locator("#prepare").click();
  await expect(page.locator("#result")).toContainText('"status":"PASS"', {
    timeout: 110000,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download prepared PDF" }).click();
  await (await download).saveAs("test-results/prepared-canary.pdf");
  await expect(page.locator("img")).toBeVisible();
  await page.screenshot({
    path: "test-results/pdf-worker.png",
    fullPage: true,
  });
});

test("shared API settings never read back the saved key and four prompt tabs are editable", async ({
  page,
}) => {
  await page.goto("/api-settings");
  await expect(
    page.getByRole("heading", { name: "API·프롬프트", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("google API 키", { exact: true })
    .fill("fixture-ci-key-only");
  await page.getByRole("button", { name: "키 저장·교체", exact: true }).click();
  await expect(
    page.getByText("키 저장됨 · 끝 4자리 only", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("google API 키", { exact: true })).toHaveValue(
    "",
  );
  for (const [label, field] of [
    ["후보 선택", "후보 선택 추가 지시"],
    ["유용성 평가", "유용성 평가 추가 지시"],
    ["일치도 평가", "일치도 평가 추가 지시"],
    ["아이디어 생성", "아이디어 생성 추가 지시"],
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await page.getByLabel(field, { exact: true }).fill("CI stage " + label);
  }
  await page
    .getByRole("button", { name: "기본 추가 지시 저장", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/api-prompts.png",
    fullPage: true,
  });
});

test("mobile can choose two providers, opt into generator names, and complete peer grading", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = "http://127.0.0.1:4174/functions/v1/api/v1/";
  const post = async (path: string, data: any) => {
    const response = await request.post(root + path, {
      data,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).data;
  };
  const paper = await post("write/paper_create", {
    title: "Mobile pair fixture",
  });
  const revision = await post("write/checkpoint_create", {
    paper_id: paper.id,
    title: "Mobile pair checkpoint",
    body: {
      input_mode: "text",
      goal: "Goal",
      obstacle: "Obstacle",
      public_text: "Public context",
      reference_idea_md: "Hidden reference",
      steps: [],
    },
  });
  await post("write/revision_approve", {
    id: revision.id,
    if_match: 1,
    checks: [true, true, true],
  });
  await page.goto("/experiments");
  await page.getByRole("button", { name: "새 실험 계획" }).click();
  await expect(
    page.getByLabel("Google Gemini 포함", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("OpenAI GPT 포함", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("Anthropic Claude 포함", { exact: true }),
  ).not.toBeChecked();
  const identity = page.getByLabel(
    "상호 채점 입력에 출력을 생성한 AI 이름 표시",
    { exact: true },
  );
  await expect(identity).not.toBeChecked();
  await identity.check();
  await page.getByLabel("실행 경로", { exact: true }).selectOption("mock");
  await page
    .getByLabel("계획 이름", { exact: true })
    .fill("Mobile paired identity");
  await page.getByLabel("후보 수 K", { exact: true }).fill("1");
  await page.getByLabel("독립 반복 R", { exact: true }).fill("1");
  await page.getByRole("checkbox", { name: /Mobile pair fixture/ }).check();
  await expect(page.locator(".design-summary")).toContainText(
    "2 run · 8개 작업",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-model-selection.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "일시정지 상태로 계획 생성" }).click();
  await expect(
    page.getByText("생성 AI 이름: 공개", { exact: true }),
  ).toBeVisible();
  const id = page.url().split("/").at(-1);
  await page.getByRole("button", { name: "시작·재개" }).click();
  for (let i = 0; i < 8; i++) await post("mock/step", {});
  await page.reload();
  await expect(page.locator(".job-grid article")).toHaveCount(8);
  await page.goto("/results?plan=" + id);
  await expect(page.locator(".metric-value").first()).not.toHaveText("—");
  await expect(
    page.getByRole("columnheader", { name: "anthropic", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/mobile-pair-results.png",
    fullPage: true,
  });
});

test("ML conditions, direct Excel and independent review exports are usable", async ({
  page,
  request,
}) => {
  const root = "http://127.0.0.1:4174/functions/v1/api/v1/";
  const post = async (path: string, data: any) => {
    const r = await request.post(root + path, {
      data,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()).data;
  };
  const paper = await post("write/paper_create", {
    title: "ML browser fixture",
    metadata: { sharing_allowed: true },
  });
  const cp = await post("write/checkpoint_create", {
    paper_id: paper.id,
    title: "Anchoring browser fixture",
    body: {
      input_mode: "text",
      task_type: "anchoring",
      decision_point: "P2",
      goal: "Fair comparison",
      obstacle: "Tune model",
      public_text: "Data split not yet chosen.",
      reference_idea_md: "Use validation only",
      research: {
        control: "Use validation for tuning",
        flawed: "Tune on test data",
        answer_reason: "Test leakage",
        rubric: [
          { id: "R1", description: "Test set stays held out", max_points: 2 },
        ],
      },
    },
  });
  await page.goto("/revisions/" + cp.id);
  await expect(
    page.getByRole("heading", { name: "문항 유형·채점 기준" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel("문항 유형", { exact: true })).toHaveValue(
    "anchoring",
  );
  await expect(
    page.getByRole("textbox", {
      name: "정상 앞 단계 (대조 조건)",
      exact: true,
    }),
  ).toHaveValue("Use validation for tuning");
  await post("write/revision_approve", {
    id: cp.id,
    if_match: 1,
    checks: [true, true, true],
  });
  const plan = await post("write/plan_create", {
    name: "ML browser test",
    k: 1,
    repeats: 1,
    cohort: "fixture",
    transport: "mock",
    selected_providers: ["anthropic"],
    revision_ids: [cp.id],
  });
  await post("write/plan_control", { id: plan.id, status: "running" });
  await post("mock/step", {});
  await post("mock/step", {});
  await page.goto("/results?plan=" + plan.id);
  await expect(
    page.getByRole("heading", { name: "ML 과제별 결과" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "검토자 고유 코드", exact: true })
    .fill("ReviewerA");
  let downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "이 검토자용 Excel 내보내기" })
    .click();
  let file = await downloading;
  expect(file.suggestedFilename()).toBe("review-independent-ReviewerA.xlsx");
  await file.saveAs("test-results/review-independent-ReviewerA.xlsx");
  await page
    .getByRole("button", { name: "Excel·연구 ZIP", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "research.xlsx 바로 다운로드" }),
  ).toBeVisible({ timeout: 30000 });
  downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "research.xlsx 바로 다운로드" })
    .click();
  file = await downloading;
  await file.saveAs("test-results/research.xlsx");
  expect(file.suggestedFilename()).toBe("research.xlsx");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page
    .getByRole("button", { name: "외부 공유 ZIP", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "research.xlsx 바로 다운로드" }),
  ).toBeVisible({ timeout: 30000 });
  const zipped = page.waitForEvent("download");
  await page.getByRole("button", { name: /ZIP 파트 1/ }).click();
  const zipFile = await zipped;
  await zipFile.saveAs("test-results/external-research.zip");
  const entries = unzipSync(
    new Uint8Array(await fs.readFile("test-results/external-research.zip")),
  );
  expect(entries["research.xlsx"]).toBeTruthy();
  expect(entries["reassemble-export.py"]).toBeTruthy();
  const snapshot = JSON.parse(
    new TextDecoder().decode(entries["analysis_snapshot.json"]),
  );
  expect(snapshot.research_reviews).toEqual([]);
  expect(snapshot.runs).toHaveLength(2);
  expect(snapshot.runs[0].exported_metrics.calculation_version).toBe(
    "metrics-v5",
  );
  expect(snapshot.inputs[0].snapshot.reference_idea_md).toBeUndefined();
  expect(snapshot.inputs[0].snapshot.research).toBeUndefined();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/research-mobile.png",
    fullPage: true,
  });
});
