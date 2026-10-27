/**
 * The questions a feature's intent.md leaves open — counted for the views a
 * person reads (`status <FEAT>`, `show <FEAT>`, the archive plan) and never
 * graded.
 *
 * A feature read `ready` over twenty-five unanswered questions, and nothing in
 * loam said there were any: the count is the one fact those views owed the
 * reviewer, and the number has to be the same one in every view.
 */
import { afterEach, describe, expect, it } from "vitest";
import { openQuestions, questionsNaming } from "../src/core/document/intent/questions.js";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const INTENT = `---
feature: FEAT-1
title: Split payments
status: proposed
---

# FEAT-1 — Split payments

## Why

Let a payment be split across payees.

## Open questions

<!-- one row per question; the scaffold's hint is nobody's question -->

| ID | Question | Blocks | Owner | Current default |
|---|---|---|---|---|
| Q1 | Is a split refunded per card or as a whole? | PAY-SPLIT-3 | payments-team | per card |
| Q2 | Who pays the second card's fee? | PAY-SPLIT-1 | finance | the payer |

- Q3: does a partial capture release the other card?
  - detail under Q3, not a question of its own

## Scope

Payments only.
`;

describe("openQuestions — what counts as one", () => {
  it("counts table rows and top-level bullets under the section, and nothing else", () => {
    const questions = openQuestions(INTENT);
    expect(questions).toHaveLength(3);
    expect(questions[0]).toContain("Q1");
    expect(questions[2]).toContain("Q3");
  });

  it("skips each table's header, so a second table under the section is counted the same way", () => {
    const text = "## Open questions\n\n| Q | Default |\n|---|---|\n| A? | a |\n\nnote\n\n| Q | Default |\n|---|---|\n| B? | b |\n";
    expect(openQuestions(text)).toEqual(["| A? | a |", "| B? | b |"]);
  });

  it("a bullet is nested by the open question's text column, not by a fixed indent", () => {
    // Detail ends where the next question starts, at whatever indent the list uses.
    expect(openQuestions("## Open questions\n\n- one?\n  - detail\n- two?\n")).toEqual(["- one?", "- two?"]);
    expect(openQuestions("## Open questions\n\n - one?\n   - detail\n - two?\n")).toEqual(["- one?", "- two?"]);
    expect(openQuestions("## Open questions\n\n1. one?\n   - detail\n2. two?\n")).toEqual(["1. one?", "2. two?"]);
    // A paragraph closes the question, so an indented bullet after it is a new one.
    expect(openQuestions("## Open questions\n\n- one?\n\nnote\n  - two?\n")).toEqual(["- one?", "- two?"]);
  });

  it("an intent with no section, an empty one, or CRLF endings", () => {
    expect(openQuestions("# FEAT-1\n\n## Why\n\n- not a question\n")).toEqual([]);
    expect(openQuestions("## Open questions\n\n<!-- write them here -->\n")).toEqual([]);
    expect(openQuestions("## Open questions\r\n\r\n- one?\r\n- two?\r\n")).toHaveLength(2);
  });
});

describe("questionsNaming — which questions are one service's", () => {
  it("matches the id as a whole word, hyphens included", () => {
    const qs = ["| Q1 | Does payment-service retry? |", "| Q2 | Is payment-service-v2 live? |", "- who owns checkout-web?"];
    expect(questionsNaming(qs, "payment-service")).toEqual([qs[0]]);
    expect(questionsNaming(qs, "checkout-web")).toEqual([qs[2]]);
  });
});

describe("every view prints the same count", () => {
  async function project(): Promise<Project> {
    const files = coherentFixture();
    files["features/FEAT-1-split/intent.md"] = INTENT;
    const p = await makeProject(files);
    cleanups.push(() => p.destroy());
    return p;
  }

  it("status <FEAT>, show <FEAT> and the archive plan", async () => {
    const p = await project();

    const status = JSON.parse((await runLoam(p.workDir, "status", "FEAT-1", "--json")).stdout);
    expect(status.feature.openQuestions).toBe(3);
    expect((await runLoam(p.workDir, "status", "FEAT-1")).out).toContain("questions     3 open");

    const show = JSON.parse((await runLoam(p.workDir, "show", "FEAT-1", "--json")).stdout);
    expect(show.review.intent.openQuestions).toBe(3);
    expect((await runLoam(p.workDir, "show", "FEAT-1")).out).toContain("intent.md  3 open questions");

    // `delta --service` prints the whole intent; the count says how many of
    // its questions are this service's.
    const delta = JSON.parse((await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service", "--json")).stdout);
    expect(delta.openQuestions).toEqual({ total: 3, naming: 0 });

    // The plan names the change by title as well as by key, and says how many
    // questions it is merging over — without refusing on them.
    const plan = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--approve");
    expect(plan.out).toContain("archive FEAT-1 · Split payments  (dry run)");
    expect(plan.out).toContain("note: 3 open question(s)");
    const planJson = JSON.parse((await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--approve", "--json")).stdout);
    expect(planJson.title).toBe("Split payments");
    expect(planJson.openQuestions).toBe(3);
  });
});
