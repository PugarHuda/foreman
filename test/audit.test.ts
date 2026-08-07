import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { escapeCell } from "../app/api/audit/route.ts";

describe("audit export cells", () => {
  it("quotes what CSV requires quoting", () => {
    assert.equal(escapeCell("plain"), "plain");
    assert.equal(escapeCell("has,comma"), '"has,comma"');
    assert.equal(escapeCell('has"quote'), '"has""quote"');
    assert.equal(escapeCell("has\nnewline"), '"has\nnewline"');
  });

  it("refuses to hand a spreadsheet a formula", () => {
    // Part numbers come from the model and end up in an auditor's Excel.
    for (const hostile of [
      '=HYPERLINK("https://evil.example","click")',
      "+1+1",
      "-2+3",
      "@SUM(A1:A9)",
      "\tleading tab",
    ]) {
      const cell = escapeCell(hostile);
      const inner = cell.startsWith('"') ? cell.slice(1) : cell;
      assert.equal(inner[0], "'", `${JSON.stringify(hostile)} was not neutralised: ${cell}`);
    }
  });

  it("leaves ordinary part numbers alone", () => {
    assert.equal(escapeCell("6205-2RS"), "6205-2RS", "a hyphen inside is not a formula");
    assert.equal(escapeCell("SPN-880"), "SPN-880");
  });

  it("renders empties rather than the word undefined", () => {
    assert.equal(escapeCell(null), "");
    assert.equal(escapeCell(undefined), "");
    assert.equal(escapeCell(0), "0");
  });
});

/**
 * The counts in the README and the demo script have gone stale three times.
 * A claim nobody checks is a claim that drifts, and a judge reading "59 tests"
 * next to a suite of 63 learns something about the rest of the document.
 */
describe("documented test counts", () => {
  /* Counted from source, so every `it(` here must be a literal one. Writing
     these two checks in a loop made one source line into two running tests
     and the counter was permanently off by one — the drift detector drifting. */
  const unitTotal = fs
    .readdirSync("test")
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => fs.readFileSync(`test/${f}`, "utf8"))
    .reduce((n, src) => n + (src.match(/^\s*it\(/gm) ?? []).length, 0);

  const specTotal = (file: string) =>
    (fs.readFileSync(file, "utf8").match(/^\s*test\(/gm) ?? []).length;

  const e2eTotal = specTotal("e2e/dashboard.spec.ts");

  /* Counted apart from the browser suite because they only run against an
     instance started in pilot configuration. Folding them into one number
     would claim coverage that `npm run test:e2e` does not actually run. */
  const pilotTotal = specTotal("e2e/pilot.spec.ts");

  const check = (doc: string) => {
    const text = fs.readFileSync(doc, "utf8");
    for (const [, claimed] of text.matchAll(/(\d+)\s+contract \+ unit/g)) {
      assert.equal(Number(claimed), unitTotal, `${doc} claims ${claimed} unit tests`);
    }
    for (const [, claimed] of text.matchAll(/(\d+)\s+(?:browser|e2e)/g)) {
      assert.equal(Number(claimed), e2eTotal, `${doc} claims ${claimed} browser tests`);
    }
    for (const [, claimed] of text.matchAll(/(\d+)\s+pilot/g)) {
      assert.equal(Number(claimed), pilotTotal, `${doc} claims ${claimed} pilot tests`);
    }
    /* The deck quotes one total rather than a breakdown. It is a document
       making a claim to a judge like any other, so it drifts like any other. */
    for (const [, claimed] of text.matchAll(/(\d+)<\/div>\s*<div className="sub">across contract/g)) {
      assert.equal(
        Number(claimed),
        unitTotal + e2eTotal + pilotTotal,
        `${doc} claims ${claimed} tests in total`,
      );
    }
  };

  it("the README states the real numbers", () => check("README.md"));

  it("the demo script states the real numbers", () => check("docs/demo-script.md"));

  it("the deck states the real numbers", () => check("app/deck/page.tsx"));
});
