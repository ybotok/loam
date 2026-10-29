/**
 * `--intent-ref` on the three briefs — `loam tasks`, `loam delta`, `loam context`.
 *
 * The defect it closes was measured on a pilot fleet (2026-10-28): every brief
 * inlined the feature's whole intent.md, so `loam tasks <FEAT> --next --json`
 * handed a worker 219,823 bytes for a unit of about 300, 215,691 of them the
 * verbatim intent, and the delta and context briefs carried the same 216 KB
 * again. Reproduced here with a synthetic intent of that shape — prose, two
 * dozen decisions and an open-questions table of 173 rows — because nothing
 * from that fleet may enter this repository.
 *
 * What is pinned, in the order an agent would be damaged by getting it wrong:
 * that the default form is untouched (the verbatim `intent` is frozen contract);
 * that the flag swaps it for a reference that really names the file — its path,
 * the sha256 of its bytes and its size — so the worker can read it once and
 * know when it moved; that the questions it keeps are the ones naming the
 * brief's own services; and that the leaf a worker is handed is then the size of
 * the unit, not of the intent.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";
import { intentReference } from "../src/core/document/intent/reference.js";

const INTENT_PATH = "features/FEAT-1-split/intent.md";

/**
 * An intent.md of roughly the pilot's size and shape: a Why, twenty-five
 * decisions under their own headings, and 173 open questions in the table the
 * authoring page asks for — every fifth naming payment-split-service, every
 * seventh payment-service, the rest naming no service at all.
 */
function largeIntent(): string {
  const prose = "The split must be recorded before the capture settles, so a payee is never paid from a share nobody wrote down. ";
  const lines = ["---", "feature: FEAT-1", "status: proposed", "---", "", "# Split payments", "", "## Why", prose.repeat(40), ""];
  lines.push("## Decisions", "");
  for (let d = 1; d <= 25; d++) lines.push(`### D-${d} — decision ${d}`, "", prose.repeat(50), "");
  lines.push("## Open questions", "", "| ID | Question | Blocks | Owner | Current default |", "|---|---|---|---|---|");
  for (let q = 1; q <= 173; q++) {
    const who = q % 5 === 0 ? "payment-split-service" : q % 7 === 0 ? "payment-service" : "the business";
    lines.push(`| Q${q} | Does ${who} own rounding case ${q}? ${prose.repeat(3)}| — | team | no |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** The ids of the open-question rows that name `service`, as `largeIntent` writes them. */
function rowsNaming(service: string): string[] {
  const out: string[] = [];
  for (let q = 1; q <= 173; q++) {
    const who = q % 5 === 0 ? "payment-split-service" : q % 7 === 0 ? "payment-service" : "the business";
    if (who === service) out.push(`Q${q}`);
  }
  return out;
}

let project: Project | undefined;
afterEach(async () => {
  await project?.destroy();
  project = undefined;
});

async function largeProject(): Promise<Project> {
  project = await makeProject({ ...coherentFixture(), [INTENT_PATH]: largeIntent() });
  return project;
}

async function fileFacts(p: Project): Promise<{ sha256: string; bytes: number }> {
  const bytes = await readFile(join(p.docsDir, INTENT_PATH));
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

interface Ref {
  path: string;
  sha256: string;
  bytes: number;
  sections: Array<{ level: number; heading: string; line: number; bytes: number }>;
  questions: { total: number; naming: Array<{ line: number }> };
}

/**
 * The ids of the rows the reference points at, read off the FILE at each line —
 * which is the whole claim a question reference makes: open the file there and
 * the question is what you find.
 */
function questionIds(ref: Ref): string[] {
  const lines = largeIntent().split("\n");
  return ref.questions.naming.map(({ line }) => /^\|\s*(Q\d+)/.exec(lines[line - 1] ?? "")?.[1] ?? `line ${line}`);
}

/** The 1-based file line of open question `id` in `largeIntent`. */
function lineOf(id: string): number {
  return largeIntent().split("\n").findIndex((row) => row.startsWith(`| ${id} |`)) + 1;
}

describe("loam tasks --intent-ref", () => {
  it("keeps the default form verbatim — the intent is frozen contract", async () => {
    const p = await largeProject();
    const res = await runLoam(p.workDir, "tasks", "FEAT-1", "--next", "--json");
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as Record<string, unknown>;
    expect(typeof out["intent"]).toBe("string");
    expect(out).not.toHaveProperty("intentRef");
    expect((out["intent"] as string).length).toBeGreaterThan(200_000);
  });

  it("hands a worker the unit, not the intent: the leaf shrinks to the unit's size", async () => {
    const p = await largeProject();
    const full = await runLoam(p.workDir, "tasks", "FEAT-1", "--next", "--json");
    const res = await runLoam(p.workDir, "tasks", "FEAT-1", "--next", "--json", "--intent-ref");
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as Record<string, unknown> & { units: Array<{ subject: string }>; intentRef: Ref };
    expect(out).not.toHaveProperty("intent");
    expect(out.units).toHaveLength(1);
    // Everything else is the same packet: only the intent's key changed.
    const { intent: _verbatim, ...rest } = JSON.parse(full.stdout) as Record<string, unknown>;
    const { intentRef: _ref, ...restRef } = out;
    expect(restRef).toEqual(rest);
    // What is left of the intent is the reference and the rows naming the
    // unit's service — a tenth of the verbatim leaf, with room to spare.
    expect(Buffer.byteLength(full.stdout)).toBeGreaterThan(200_000);
    expect(Buffer.byteLength(res.stdout) * 10).toBeLessThan(Buffer.byteLength(full.stdout));
  });

  it("names the file it stands for: path, the sha256 of its bytes, its size", async () => {
    const p = await largeProject();
    const res = await runLoam(p.workDir, "tasks", "FEAT-1", "--next", "--json", "--intent-ref");
    const ref = (JSON.parse(res.stdout) as { intentRef: Ref }).intentRef;
    expect(ref.path).toBe(INTENT_PATH);
    expect({ sha256: ref.sha256, bytes: ref.bytes }).toEqual(await fileFacts(p));
  });

  it("keeps the open questions naming the leaf's own service, and counts the rest", async () => {
    const p = await largeProject();
    const res = await runLoam(p.workDir, "tasks", "FEAT-1", "--next", "--json", "--intent-ref");
    const out = JSON.parse(res.stdout) as { units: Array<{ subject: string }>; intentRef: Ref };
    const subject = out.units[0]!.subject;
    expect(out.intentRef.questions.total).toBe(173);
    expect(questionIds(out.intentRef)).toEqual(rowsNaming(subject));
  });

  it("refuses an intent that is not UTF-8 rather than referencing it as empty", async () => {
    // PowerShell's `>` writes UTF-16LE with a byte-order mark. Read leniently,
    // this file had no sections and no open questions — "nothing here for you",
    // under a digest no file tool could reproduce.
    const text = "# Split payments\n\n## Open questions\n- does payment-service round?\n";
    project = await makeProject(coherentFixture());
    await writeFile(join(project.docsDir, INTENT_PATH), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
    for (const args of [
      ["tasks", "FEAT-1", "--json", "--intent-ref"],
      ["delta", "FEAT-1", "--service", "payment-service", "--json", "--intent-ref"],
      ["context", "payment-service", "--feature", "FEAT-1", "--json", "--intent-ref"],
    ]) {
      const res = await runLoam(project.workDir, ...args);
      expect(res.code, args.join(" ")).toBe(1);
      const out = JSON.parse(res.stdout) as { ok: boolean; error: { code: string; message: string } };
      expect(out.error.code, args.join(" ")).toBe("repository-unavailable");
      expect(out.error.message, args.join(" ")).toContain("intent.md");
    }
  });

  it("says null when the feature has no intent.md, rather than inventing a reference", async () => {
    const files = coherentFixture();
    delete files[INTENT_PATH];
    project = await makeProject(files);
    const res = await runLoam(project.workDir, "tasks", "FEAT-1", "--json", "--intent-ref");
    const out = JSON.parse(res.stdout) as Record<string, unknown>;
    expect(out["intentRef"]).toBeNull();
    expect(out).not.toHaveProperty("intent");
  });
});

describe("loam delta --intent-ref", () => {
  it("swaps the intent for a reference holding this service's questions only", async () => {
    const p = await largeProject();
    const full = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service", "--json");
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service", "--json", "--intent-ref");
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as Record<string, unknown> & { intentRef: Ref; openQuestions: { total: number; naming: number } };
    expect(out).not.toHaveProperty("intent");
    expect(out.intentRef.path).toBe(INTENT_PATH);
    expect({ sha256: out.intentRef.sha256, bytes: out.intentRef.bytes }).toEqual(await fileFacts(p));
    expect(questionIds(out.intentRef)).toEqual(rowsNaming("payment-service"));
    // The count the default form already carried agrees with the rows the reference keeps.
    expect(out.openQuestions.naming).toBe(out.intentRef.questions.naming.length);
    const { intent: _verbatim, ...rest } = JSON.parse(full.stdout) as Record<string, unknown>;
    const { intentRef: _ref, ...restRef } = out;
    expect(restRef).toEqual(rest);
    expect(Buffer.byteLength(full.stdout) - Buffer.byteLength(res.stdout)).toBeGreaterThan(190_000);
  });

  it("prints the reference, not the text, in the human view", async () => {
    const p = await largeProject();
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service", "--intent-ref");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(INTENT_PATH);
    // The decisions are headings in the file; inlined, every one of them printed.
    expect(res.stdout).not.toContain("decision 25");
    // The rows naming this service are the part of the intent that is its work,
    // and the view says where they are rather than reprinting them.
    expect(res.stdout).not.toContain("| Q7 |");
    expect(res.stdout).toContain(`at lines ${lineOf("Q7")}, ${lineOf("Q14")}`);
    expect(res.stdout.length).toBeLessThan(20_000);
  });
});

describe("loam context --intent-ref", () => {
  it("carries each in-flight feature's intent by reference, scoped to the pack's service", async () => {
    const p = await largeProject();
    const res = await runLoam(p.workDir, "context", "payment-service", "--feature", "FEAT-1", "--json", "--intent-ref");
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as { features: Array<Record<string, unknown> & { intentRef: Ref }> };
    expect(out.features).toHaveLength(1);
    const feature = out.features[0]!;
    expect(feature).not.toHaveProperty("intent");
    expect({ sha256: feature.intentRef.sha256, bytes: feature.intentRef.bytes }).toEqual(await fileFacts(p));
    expect(questionIds(feature.intentRef)).toEqual(rowsNaming("payment-service"));
    expect(Buffer.byteLength(res.stdout)).toBeLessThan(40_000);
  });

  it("does the same for the pack of a service the feature introduces", async () => {
    const p = await largeProject();
    const res = await runLoam(p.workDir, "context", "payment-split-service", "--json", "--intent-ref");
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as { living: boolean; features: Array<Record<string, unknown> & { intentRef: Ref }> };
    expect(out.living).toBe(false);
    expect(out.features[0]).not.toHaveProperty("intent");
    expect(questionIds(out.features[0]!.intentRef)).toEqual(rowsNaming("payment-split-service"));
  });

  it("keeps the default pack verbatim", async () => {
    const p = await largeProject();
    const res = await runLoam(p.workDir, "context", "payment-service", "--feature", "FEAT-1", "--json");
    const out = JSON.parse(res.stdout) as { features: Array<Record<string, unknown>> };
    expect(typeof out.features[0]!["intent"]).toBe("string");
    expect(out.features[0]).not.toHaveProperty("intentRef");
  });
});

describe("intentReference — the outline", () => {
  it("lists headings by FILE line, skipping the frontmatter and fenced blocks", () => {
    const text = [
      "---",
      "# not a heading: a YAML comment",
      "feature: FEAT-1",
      "---",
      "# Title",
      "",
      "## Why",
      "because",
      "```",
      "# fenced, not a heading",
      "```",
      "### Detail",
      "## Open questions",
      "- does payment-service round? ",
      "",
    ].join("\n");
    const ref = intentReference(Buffer.from(text, "utf8"), INTENT_PATH, ["payment-service"]);
    expect(ref.sections.map((s) => [s.level, s.heading, s.line])).toEqual([
      [1, "Title", 5],
      [2, "Why", 7],
      [3, "Detail", 12],
      [2, "Open questions", 13],
    ]);
    // A level-1 section runs to the end; the Why runs to the next level-2 heading, its ### detail included.
    expect(ref.sections[0]!.bytes).toBe(Buffer.byteLength(text.split("\n").slice(4).join("\n")));
    expect(ref.sections[1]!.bytes).toBe(Buffer.byteLength(text.split("\n").slice(6, 12).join("\n") + "\n"));
    expect(ref.questions).toEqual({ total: 1, naming: [{ line: 14 }] });
    expect(ref.bytes).toBe(Buffer.byteLength(text));
  });

  it("counts lines from the top of a CRLF file with a byte-order mark", () => {
    const text = "﻿---\r\nfeature: FEAT-1\r\n---\r\n# Title\r\n## Why\r\n";
    const ref = intentReference(Buffer.from(text, "utf8"), INTENT_PATH, []);
    expect(ref.sections.map((s) => [s.heading, s.line])).toEqual([
      ["Title", 4],
      ["Why", 5],
    ]);
  });

  it("points each question at its own line, even below a comment that spans lines", () => {
    // The comments are cut before the rows are read, and a cut that forgot the
    // lines it took would send every question below it up by that many.
    const text = [
      "## Open questions", // 1
      "<!-- the scaffold's hint,", // 2
      "     over two lines -->", // 3
      "| ID | Question |", // 4
      "|---|---|", // 5
      "| Q1 | does payment-service round? |", // 6
      "| Q2 | does the ledger? |", // 7
      "| Q3 | <!-- inline --> payment-service retries? |", // 8
      "",
    ].join("\r\n");
    const ref = intentReference(Buffer.from(text, "utf8"), INTENT_PATH, ["payment-service"]);
    expect(ref.questions).toEqual({ total: 3, naming: [{ line: 6 }, { line: 8 }] });
  });

  it("points a question that follows a comment on the comment's last line at that line", () => {
    // Cut, the comment leaves the question on a result line that BEGINS on the
    // comment's first line; the question itself is where its first character is.
    const text = ["## Open questions", "<!-- the scaffold's hint,", "over two lines -->- does payment-service retry?", ""].join("\n");
    const ref = intentReference(Buffer.from(text, "utf8"), INTENT_PATH, ["payment-service"]);
    expect(ref.questions).toEqual({ total: 1, naming: [{ line: 3 }] });
  });
});
