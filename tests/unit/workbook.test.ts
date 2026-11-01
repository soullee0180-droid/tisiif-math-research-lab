import { it, expect } from "vitest";
import ExcelJS from "exceljs";
import { workbook, sheetNames, safeCell } from "../../apps/web/src/workbook";
it("roundtrips all documented sheets, protects formulas and preserves long UTF-8 sidecars", async () => {
  const text = "수학".repeat(16000),
    data = {
      runs: [
        {
          id: "r",
          k: 1,
          selected: "I1",
          ideas: [
            {
              id: "i",
              candidate_id: "I1",
              title: '=HYPERLINK("evil")',
              idea_md: text,
              u: [2, 2],
              match: ["core", "core"],
              usefulness: [],
              agreement: [],
            },
          ],
          generator: "google",
          cohort: "fixture",
          transport: "mock",
          condition_hash: "x",
          paper_id: "p",
          checkpoint_id: "c",
          revision_id: "v",
          repeat_index: 1,
        },
      ],
      inputs: [],
      plans: [],
      models: [],
      attempts: [],
      jobs: [],
      reviews: [],
      review_samples: [],
    };
  const out = await workbook(data, { id: "a", sha256: "h", filters: {} });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(out.bytes as any);
  expect(book.worksheets.map((s) => s.name)).toEqual(sheetNames);
  expect(book.getWorksheet("후보_아이디어")!.getRow(2).getCell(11).value).toBe(
    '\'=HYPERLINK("evil")',
  );
  expect(new TextDecoder().decode(Object.values(out.sidecars)[0])).toBe(text);
  expect(book.getWorksheet("긴텍스트_목록")!.rowCount).toBe(2);
  expect(safeCell(null)).toBeNull();
  for (const v of ["  =1", "+sum()", "-evil", "@formula"])
    expect(safeCell(v)).toBe("'" + v);
});
