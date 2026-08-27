/**
 * The architecture gate's own gate: one representative violation per check,
 * each proven to FAIL `node scripts/arch-check.mjs --root <fixture>`.
 *
 * The gate's checks are regex over source — honest-but-approximate by its own
 * banner — so this suite is what stops a pattern from quietly becoming a
 * no-op: a formatter change or a refactor that breaks a regex breaks these
 * fixtures' refusals, loudly. The one positive case runs the gate against the
 * real repository, which is also the pin that the tree's standing violations
 * (config's console.error, the coherence re-export, the unbounded git call)
 * stayed fixed.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gate = join(repoRoot, "scripts", "arch-check.mjs");

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "loam-arch-gate-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return root;
}

/** Run the gate on a tree; the policy the gate itself enforces applies to us too. */
async function gateOn(root: string): Promise<{ code: number; err: string }> {
  try {
    await run(process.execPath, [gate, "--root", root], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, err: "" };
  } catch (e) {
    const err = e as { code?: number; stderr?: string };
    return { code: typeof err.code === "number" ? err.code : -1, err: err.stderr ?? "" };
  }
}

describe("each architecture check refuses its representative violation", () => {
  it("a file-level import cycle", async () => {
    const root = await fixture({
      "src/a.ts": 'import { b } from "./b.js";\nexport const a = 1 + b;\n',
      "src/b.ts": 'import { a } from "./a.js";\nexport const b = 1 + a;\n',
    });
    const res = await gateOn(root);
    expect(res.code).toBe(1);
    // "reports a cycle", not merely the check name: the name also appears in
    // the could-not-run arm, and this fixture must stand on the cycle alone.
    expect(res.err).toContain("reports a cycle");
  }, 200_000);

  it("a package-only cycle the file graph cannot see", async () => {
    const root = await fixture({
      "src/p/x.ts": 'import { y } from "../q/y.js";\nexport const x = y;\n',
      "src/q/y.ts": "export const y = 1;\n",
      "src/q/z.ts": 'import { w } from "../p/w.js";\nexport const z = w;\n',
      "src/p/w.ts": "export const w = 2;\n",
    });
    const res = await gateOn(root);
    expect(res.code).toBe(1);
    expect(res.err).toContain("package-graph");
  }, 200_000);

  it("a core module importing commands", async () => {
    const root = await fixture({
      "src/core/a.ts": 'import { c } from "../commands/c.js";\nexport const a = c;\n',
      "src/commands/c.ts": "export const c = 1;\n",
    });
    const res = await gateOn(root);
    expect(res.code).toBe(1);
    expect(res.err).toContain("layering");
  }, 200_000);

  it("a barrel re-export, the type-only form included", async () => {
    const root = await fixture({
      "src/x/a.ts": 'export type { T } from "./b.js";\n',
      "src/x/b.ts": "export type T = string;\n",
    });
    const res = await gateOn(root);
    expect(res.code).toBe(1);
    expect(res.err).toContain("barrels");
  }, 200_000);

  it("console output inside core, outside the envelope adapter", async () => {
    const root = await fixture({
      "src/core/a.ts": 'export function f(): void {\n  console.log("x");\n}\n',
    });
    const res = await gateOn(root);
    expect(res.code).toBe(1);
    expect(res.err).toContain("core-boundary");
  }, 200_000);

  it("a child process with no deadline", async () => {
    const root = await fixture({
      "src/a.ts":
        'import { execFile } from "node:child_process";\nexport function f(): void {\n  execFile("git", ["--version"], () => undefined);\n}\n',
    });
    const res = await gateOn(root);
    expect(res.code).toBe(1);
    expect(res.err).toContain("child-process");
  }, 200_000);

  it("a buffering child process with a deadline but no output cap", async () => {
    // The check enforces two rules; a fixture per rule, or a regression in
    // the maxBuffer half would be invisible while the timeout half kept the
    // suite green.
    const root = await fixture({
      "src/a.ts":
        'import { execFile } from "node:child_process";\nexport function f(): void {\n  execFile("git", ["--version"], { timeout: 1000 }, () => undefined);\n}\n',
    });
    const res = await gateOn(root);
    expect(res.code).toBe(1);
    expect(res.err).toContain("maxBuffer");
  }, 200_000);

  it("a violation hiding behind a glob string and a line comment with /* in it", async () => {
    // The chained-regex codeOnly once opened a phantom block comment on the
    // `/*` inside a comment or a string ("features/**") and blanked real code
    // to the next `*​/` — an injected violation in the blanked region passed
    // the gate. This fixture pins the preprocessing, not any one rule.
    const root = await fixture({
      "src/core/a.ts":
        '// the glob `features/**` lands happily in any directory\n' +
        'const glob = "services/**";\n' +
        'export function f(): string {\n  console.log("must be seen");\n  return glob;\n}\n',
    });
    const res = await gateOn(root);
    expect(res.code).toBe(1);
    expect(res.err).toContain("core-boundary");
  }, 200_000);

  it("a fixture reached through a symlinked root still fails — the gate resolves the real path", async () => {
    // macOS's tmpdir is a symlink (/var/folders -> /private/var/folders) and
    // oxlint walking THROUGH a link silently scans zero files and exits 0.
    // CI's /tmp is real, so without this fixture deleting the realpath call
    // would stay green in CI and blind the gate for every macOS developer.
    const real = await fixture({
      "src/a.ts": 'import { b } from "./b.js";\nexport const a = 1 + b;\n',
      "src/b.ts": 'import { a } from "./a.js";\nexport const b = 1 + a;\n',
    });
    const linkParent = await mkdtemp(join(tmpdir(), "loam-arch-link-"));
    const link = join(linkParent, "root");
    await symlink(real, link);
    const res = await gateOn(link);
    expect(res.code).toBe(1);
    expect(res.err).toContain("reports a cycle");
  }, 200_000);

  it("a brand cast outside the constructor modules", async () => {
    const root = await fixture({
      "src/a.ts": 'type ServiceId = string & { readonly brand: unique symbol };\nexport const s = "x" as ServiceId;\n',
    });
    const res = await gateOn(root);
    expect(res.code).toBe(1);
    expect(res.err).toContain("brand-casts");
  }, 200_000);
  it("a call into LikeC4's computed view stage", async () => {
    const root = await fixture({
      "src/core/c4/render.ts": 'export async function draw(m: { computedModel(): unknown }) {\n  return m.computedModel();\n}\n',
    });
    const res = await gateOn(root);
    expect(res.code).toBe(1);
    expect(res.err).toContain("view-stage");
  }, 200_000);

  it("a raw `$data` read outside src/core/c4/parsed/, while the reader itself stays legal", async () => {
    // Two fixtures in one case, because a confinement scan has two ways to go
    // wrong and only one of them is a false green: banning nothing, and banning
    // the one module the rule exists to permit. The second assertion is what
    // stops a later tightening from fencing the reader out of its own record.
    const leaked = await fixture({
      "src/core/c4/leak.ts": "export function read(m: { $data: { views: unknown } }) {\n  return m.$data.views;\n}\n",
    });
    const res = await gateOn(leaked);
    expect(res.code).toBe(1);
    expect(res.err).toContain("view-stage");

    const permitted = await fixture({
      "src/core/c4/parsed/dynamic-views.ts": "export function read(m: { $data: { views: unknown } }) {\n  return m.$data.views;\n}\n",
    });
    expect((await gateOn(permitted)).code).toBe(0);
  }, 200_000);
});

describe("the gate's own lists cannot go stale silently", () => {
  it("every unique-symbol brand under src/core/kernel/ appears in arch-check's BRANDS list", async () => {
    // The cast scan's whole value is exhaustiveness, and its list is a
    // hand-maintained literal: the next brand nobody adds to it would compile a
    // cast anywhere while the gate stayed green.
    const gateSource = await readFile(gate, "utf8");
    const brands = /const BRANDS = \[([^\]]*)\]/.exec(gateSource)?.[1] ?? "";
    const kernel = join(repoRoot, "src", "core", "kernel");
    const declared: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (entry.name.endsWith(".ts")) {
          const text = await readFile(p, "utf8");
          for (const m of text.matchAll(/export type (\w+) =[^;]*readonly \[/g)) declared.push(m[1]!);
        }
      }
    };
    await walk(kernel);
    expect(declared.length).toBeGreaterThan(3);
    for (const name of declared) expect(brands, `brand ${name} missing from BRANDS`).toContain(`"${name}"`);
  });
});

describe("the gate over the real tree", () => {
  it("passes — every stated invariant holds on this repository", async () => {
    const res = await gateOn(repoRoot);
    expect(res.err).toBe("");
    expect(res.code).toBe(0);
  }, 300_000);
});
