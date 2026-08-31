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
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  AUTO_PACKAGED,
  EXAMPLE_MARKDOWN,
  PACKAGED_MARKDOWN,
  REVIEWED_PACKAGE_FILES,
  auditPageLinks,
  markdownLinks,
} from "../scripts/package-docs.mjs";

const ROOT = join(import.meta.dirname, "..");

/**
 * Every file under one of the DIRECTORY entries in `files[]`, package-root
 * relative with forward slashes.
 *
 * `dist` and `examples` ship whole, so a page inside them may link a sibling
 * that is not Markdown at all: the example fleet's ADR points at
 * `../landscape.likec4`, which the tarball carries and no `.md` list names.
 * The smoke answers this question from the tarball's own path listing; here it
 * is answered by walking the tree npm will pack, which is the same set.
 */
async function shippedUnder(entry: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, item.name);
      if (item.isDirectory()) await walk(abs);
      else out.push(relative(ROOT, abs).split(/[\\/]/).join("/"));
    }
  };
  await walk(join(ROOT, entry));
  return out;
}

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

  it("EXAMPLE_MARKDOWN names every Markdown page the examples tree ships, and only those", async () => {
    // The `examples` entry ships a TREE, so its pages join files[] without
    // being named there — and PACKAGED_MARKDOWN is what package-smoke.mjs
    // set-equality-checks against the Markdown the tarball actually carries.
    // Without this assertion an example page added and not listed would leave
    // `npm test` green and fail the separate `package` CI job with a
    // packaging error, one push later and nowhere near the edit that caused
    // it. It is also the page that would have shipped unaudited by the link
    // check below.
    const actual = (await shippedUnder("examples")).filter((p) => p.endsWith(".md")).sort();
    expect(
      actual,
      "examples/ Markdown and EXAMPLE_MARKDOWN in scripts/package-docs.mjs disagree — add (or drop) the page there too",
    ).toEqual([...EXAMPLE_MARKDOWN].sort());
  });
});

describe("working-tree link integrity for the shipped pages", () => {
  it("every relative link stays inside the package, every anchor resolves, every canonical link names a real path", async () => {
    // The same audit the smoke runs against the installed tree, against the
    // working tree: relative targets must be files the tarball will carry
    // (reviewed .md, npm's automatic README/LICENSE/package.json, and every
    // file inside the shipped example tree), anchors must slug-match exactly
    // one heading in the shipped target (including the WORKFLOW.md →
    // SCHEMA.md#canonical-joins cross-file case), and canonical
    // github.com/ybotok/loam blob|tree/main links must name paths that exist —
    // the "intentionally canonical" escape hatch is checked, not trusted.
    //
    // Targets are resolved against the page's own directory, which is what
    // shipping a subdirectory made necessary: examples/README.md's
    // `../SCHEMA.md` is the root page, and examples/docs/glossary/order.md's
    // `payments/authorization.md` is its own neighbour, not a root file.
    const shippedMarkdown = REVIEWED_PACKAGE_FILES.filter((path) => path.endsWith(".md"));
    const linkable = new Set([
      ...shippedMarkdown,
      ...AUTO_PACKAGED,
      ...(await shippedUnder("examples")),
    ]);
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
