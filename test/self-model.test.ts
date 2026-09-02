/**
 * Pins meta/docs — loam's model of ITSELF — against the real commands, the way
 * test/examples.test.ts pins examples/docs. Nothing else in the suite reads the
 * meta tree, so without this file it can drift from the checks and the first
 * person to notice is whoever next opens `npm run meta:check` and finds it
 * grading a repository loam no longer agrees with.
 *
 * `npm run meta:check` (scripts/self-model.mjs) and this file are the two halves
 * of the axis and they ask different questions. That script asks whether the
 * MODEL still describes `src/` — a package with no box, a box with no package —
 * which loam will never answer for anybody, because it reads no source tree.
 * This file asks whether loam still grades its own docs tree the way it did,
 * which the script cannot answer because it never runs loam.
 *
 * The finding set is pinned EXACTLY, not merely bounded, on examples.test.ts's
 * reasoning: an exact match makes any new code that starts firing on the
 * self-model loud instead of quietly accumulating. It is also the only defence
 * this axis has against its own headline weakness — a fleet's worth of checks
 * are SILENT here (no OpenAPI, no AsyncAPI, no permissions, no capabilities, no
 * health, no use case, no feature in flight), and a bounded assertion over a
 * mostly-silent run would pass whatever happened.
 *
 * The two warnings are `sources.absent`, once per spec axis, and they are a
 * finding about loam rather than about this tree: a spec's `sources` resolve
 * against process.cwd() when loam.json names that service, this config sits at
 * meta/ one directory BELOW the tree it describes, and `../src/` is refused as
 * an escape from the repository. There is no spelling that would work, which is
 * why the warnings are pinned rather than fixed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTmpDir, runLoam, treeHashes } from "./helpers/harness.js";

const META = fileURLToPath(new URL("../meta/docs", import.meta.url));

// Copied into a temp dir rather than validated in place: only read-only
// commands run here today, but a test must not be one bug away from rewriting
// the repository's own self-model.
let root: string;
let workDir: string;
let docsDir: string;

beforeAll(async () => {
  root = await makeTmpDir();
  workDir = join(root, "work");
  docsDir = join(root, "docs");
  await mkdir(workDir, { recursive: true });
  await cp(META, docsDir, { recursive: true });
  await writeFile(join(workDir, "loam.json"), JSON.stringify({ docsDir }, null, 2) + "\n", "utf8");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Finding {
  severity: string;
  code: string;
}
interface Payload {
  ok: boolean;
  valid: boolean;
  summary: { services: number; features: number; errors: number; warnings: number };
  scorecard: { c4: { elements: number; covered: number }; adoption: { arch: number; openapi: number } };
  targets: Array<{ kind: string; id: string; findings: Finding[] }>;
}

const runValidateAll = async (): Promise<Payload> => {
  const res = await runLoam(workDir, "validate", "--all", "--json");
  expect(res.code).toBe(0);
  return JSON.parse(res.stdout) as Payload;
};

/**
 * One `validate --all` for the four read-only assertions, memoised.
 *
 * `--all` spins a LikeC4 workspace over a landscape of 70 elements and 403
 * relationships, and it is the same read-only answer every time — five runs was
 * five identical parses and about four seconds of the CI budget this axis is
 * supposed to be measured against. The byte-identity test below deliberately
 * does NOT use this: its whole subject is a run that has actually happened.
 */
let memo: Promise<Payload> | undefined;
const validateAll = async (): Promise<Payload> => (memo ??= runValidateAll());

const codes = (payload: Payload, severity: string): string[] =>
  payload.targets
    .flatMap((t) => t.findings)
    .filter((f) => f.severity === severity)
    .map((f) => f.code)
    .sort();

describe("meta/docs vs loam validate --all", () => {
  it("is valid: zero errors, and exactly the two sources warnings", async () => {
    const payload = await validateAll();
    expect(payload.ok).toBe(true);
    expect(payload.valid).toBe(true);
    expect(payload.summary).toEqual({ services: 1, features: 0, errors: 0, warnings: 2 });
    expect(codes(payload, "error")).toEqual([]);
    // Both axes name no sources, for the reason in this file's banner. If a
    // third warning ever joins them, a check that was silent has started
    // speaking and somebody has to decide whether it is right.
    expect(codes(payload, "warn")).toEqual(["sources.absent", "sources.absent"]);
  });

  it("every Covers: line resolves — no covers.unknown, and the check is not vacuous", async () => {
    // The ONE mechanical grade this axis actually gets from loam, so it is
    // asserted by name rather than left to the count above. It is also the
    // only thing standing between an arch.spec.md that names real model
    // objects and one that names plausible-looking strings.
    const payload = await validateAll();
    const all = payload.targets.flatMap((t) => t.findings).map((f) => f.code);
    expect(all).not.toContain("covers.unknown");
    // The positive control: the arch axis was READ, and had requirements in it
    // to grade. Without this, deleting arch.spec.md would pass the line above.
    expect(all.filter((c) => c === "requirements.covered")).toHaveLength(2);
    expect(payload.scorecard.adoption.arch).toBe(1);
  });

  it("counts one C4 element, not seventy — the census is service-level", async () => {
    // A standing finding about the PRODUCT, pinned so it cannot change
    // unnoticed. The landscape draws 70 containers of `src/`; the fleet
    // scorecard counts drawn SYSTEMS, so it reports one. Nothing is wrong with
    // either number — but `c4: { elements: 1, covered: 0 }` must never be read
    // as "loam's architecture is one box and nothing covers it".
    const payload = await validateAll();
    expect(payload.scorecard.c4).toEqual({ elements: 1, covered: 0 });
  });

  it("has no feature in flight, so the whole delta axis is silent — and it has SHIPPED one", async () => {
    // `c4.uncovered` — the mechanical "every element and edge a delta
    // INTRODUCES wants a covering requirement" — is graded only on what a
    // feature delta carries. With zero features in flight it cannot fire, which
    // is why the containers and edges no arch requirement names raise nothing.
    //
    // This assertion has now been through the round trip it was written to
    // survive, and the trail is worth keeping. FEAT-1 — the deployment axis —
    // was authored here, graded here with six tagged edges each reported
    // `archedge.covered`, and archived here; between those two moments this
    // case read `features: 1` and carried that count as its control. So the
    // silence below is the silence of a fleet with nothing in flight, PROVEN
    // distinguishable from the silence of a fleet where the axis is dead: the
    // archived feature under `features/archive/` is the evidence, and the
    // landscape's six new relationships are what it left behind.
    const payload = await validateAll();
    expect(payload.summary.features).toBe(0);
    expect(payload.targets.filter((t) => t.kind === "feature")).toEqual([]);
    expect(payload.targets.flatMap((t) => t.findings).map((f) => f.code)).not.toContain("c4.uncovered");
  });

  it("writes nothing — the self-model tree is byte-identical after a full validate", async () => {
    const before = await treeHashes(docsDir);
    await runValidateAll();
    expect(await treeHashes(docsDir)).toEqual(before);
  });
});
