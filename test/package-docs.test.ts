/**
 * The gate-time half of the package-composition and link-integrity guards.
 *
 * scripts/package-smoke.mjs proves the same properties from the tarball users
 * actually install, but `npm run test:package` runs in CI and the release
 * gate, not on anybody's inner loop — `npm test` is the gate developers run
 * before push, so this file audits the working tree with the SAME shared list
 * and link helpers (scripts/package-docs.mjs). The duplication is deliberate:
 * two different artifacts under test, one rule engine.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_PACKAGED,
  PACKAGED_MARKDOWN,
  REVIEWED_PACKAGE_FILES,
  auditPageLinks,
  markdownLinks,
} from "../scripts/package-docs.mjs";

const ROOT = join(import.meta.dirname, "..");

describe("the package ships one reviewed document list", () => {
  it("package.json files[] set-equals REVIEWED_PACKAGE_FILES", async () => {
    // Editing either side alone must fail: files[] is what npm ships,
    // the reviewed list is what the smoke, the release preflight and this
    // suite verify. scripts/release-check.mjs blocks a release on the same
    // rule; this copy fails the ordinary gate first.
    const manifest = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
      files: string[];
    };
    expect([...manifest.files].sort()).toEqual([...REVIEWED_PACKAGE_FILES].sort());
    expect(manifest.files.length).toBe(REVIEWED_PACKAGE_FILES.length);
  });

  it("every reviewed Markdown page is relatively linked from README.md", async () => {
    // The public documentation's copy of the reviewed list: a shipped page
    // nobody can navigate to from the front page is shipped in name only. A
    // tenth document joining files[] therefore needs a README pointer in the
    // same change.
    const readme = await readFile(join(ROOT, "README.md"), "utf8");
    const relativeTargets = new Set(markdownLinks(readme).map((link) => link.target));
    const unlinked = REVIEWED_PACKAGE_FILES.filter(
      (path) => path.endsWith(".md") && !relativeTargets.has(path),
    );
    expect(
      unlinked,
      `reviewed package page(s) never linked from README.md: ${unlinked.join(", ")} — add a relative link (the Docs section is the usual home)`,
    ).toEqual([]);
  });
});

describe("working-tree link integrity for the shipped pages", () => {
  it("every relative link stays inside the package, every anchor resolves, every canonical link names a real path", async () => {
    // The same audit the smoke runs against the installed tree, against the
    // working tree: relative targets must be files the tarball will carry
    // (reviewed .md plus npm's automatic README/LICENSE/package.json), anchors
    // must slug-match exactly one heading in the shipped target (including the
    // WORKFLOW.md → SCHEMA.md#canonical-joins cross-file case), and canonical
    // github.com/ybotok/loam blob|tree/main links must name paths that exist —
    // the "intentionally canonical" escape hatch is checked, not trusted.
    const shippedMarkdown = REVIEWED_PACKAGE_FILES.filter((path) => path.endsWith(".md"));
    const linkable = new Set([...shippedMarkdown, ...AUTO_PACKAGED]);
    const pages = new Map<string, string>();
    for (const page of PACKAGED_MARKDOWN) {
      pages.set(page, await readFile(join(ROOT, page), "utf8"));
    }
    const failures: string[] = [];
    for (const [page, text] of pages) {
      failures.push(
        ...auditPageLinks(page, text, {
          hasFile: (path: string) => linkable.has(path),
          // `pages` already holds every PACKAGED_MARKDOWN page, so a miss IS
          // "not a shipped Markdown page" — no second read exists to fall to.
          readDoc: (path: string) => pages.get(path) ?? null,
          hasRepoPath: (path: string) => existsSync(join(ROOT, path)),
        }),
      );
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
