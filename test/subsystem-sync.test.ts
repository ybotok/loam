/**
 * The WIRING of the second generated file — `architecture/services.likec4`,
 * one overview view per service the fleet map draws.
 *
 * `test/subsystems-views.test.ts` pins what the two files SAY. This suite pins
 * who writes them, who grades them, and who must never read them:
 *
 *  - `loam subsystem sync` writes BOTH in one commit, and a second run reports
 *    `current` and writes not one byte.
 *  - `loam validate --all` reports ONE `subsystem.views-stale` per stale file,
 *    each naming its own file — one code, two subjects.
 *  - a change to the MAP alone restales the per-service file and leaves the
 *    subsystem file exactly as it is, which is the whole reason the two are
 *    graded apart rather than folded into one answer.
 *  - a subsystem VERB lands the per-service file in the commit that changes the
 *    tree, because a view's title carries the placement the verb just changed.
 *  - neither file is written over a document loam did not write, by ANY of the
 *    five writers: both names are RESERVED inside a directory the team owns, so
 *    a file whose first line is not loam's mark is refused, survives byte for
 *    byte, and the run exits 1. `sync` refuses the one file and completes the
 *    rest; a subsystem VERB refuses whole, because its generated file has to
 *    land in the same commit as the change to the tree. (`loam seed`, the fifth,
 *    is pinned in `test/seed.test.ts` beside its own never-overwrite promise.)
 *  - every project read drops both generated documents. That is the rule the
 *    one `GENERATED_ARCHITECTURE_FILES` table exists to keep, and a file listed
 *    by one reader and forgotten by another fails silently: a views-only
 *    document does not parse standalone, so a reader that kept one would blank
 *    the whole model over a file whose only fault is that `sync` has not run.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GENERATED_MARK } from "../src/core/repo/tree/render/service/header.js";
import { coherentFixture, makeProject, runLoam, treeHashes } from "./helpers/harness.js";

const SUBSYSTEM_VIEWS = "architecture/subsystems.likec4";
const SERVICE_VIEWS = "architecture/services.likec4";

interface Finding {
  code: string;
  subject?: string;
  message: string;
}

/** Every `subsystem.*` finding of a `validate --all --json` run, in report order. */
function subsystemFindings(stdout: string): Finding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: Finding[] }> };
  return payload.targets.flatMap((t) => t.findings).filter((f) => f.code.startsWith("subsystem."));
}

/** `coherentFixture()` with payment-service filed into a marked subsystem, so both files have work to do. */
function nestedFixture(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(coherentFixture())) {
    files[path.replace(/^services\/payment-service\//, "services/payments/payment-service/")] = content;
  }
  files["services/payments/subsystem.yaml"] = "title: Payments\n";
  files["services/checkout-web/spec.md"] = "---\nservice: checkout-web\nstatus: draft\n---\n\n# checkout-web\n";
  return files;
}

describe("loam subsystem sync writes both generated files, and only what changed", () => {
  it("creates both, reports each under its own key, and a second run writes not one byte", async () => {
    const p = await makeProject(nestedFixture());
    try {
      const first = JSON.parse((await runLoam(p.workDir, "subsystem", "sync", "--json")).stdout);
      // `path` and `action` keep their frozen meaning — the subsystem file —
      // and the second file arrives as a key of its own beside them.
      expect(first.path).toBe(SUBSYSTEM_VIEWS);
      expect(first.action).toBe("created");
      expect(first.serviceViews).toEqual({ path: SERVICE_VIEWS, action: "created" });
      expect(p.exists(SERVICE_VIEWS)).toBe(true);

      // Idempotent BY CONSTRUCTION: the expected bytes are a pure function of
      // the tree and the committed map, so the second run has nothing to do.
      // `treeHashes` is what says "wrote nothing" rather than "wrote the same".
      const before = await treeHashes(p.docsDir);
      const second = JSON.parse((await runLoam(p.workDir, "subsystem", "sync", "--json")).stdout);
      expect(second.action).toBe("current");
      expect(second.serviceViews).toEqual({ path: SERVICE_VIEWS, action: "current" });
      expect(await treeHashes(p.docsDir)).toEqual(before);

      const text = await runLoam(p.workDir, "subsystem", "sync");
      expect(text.stdout).toContain(`${SUBSYSTEM_VIEWS} is current`);
      // Silent about a file nothing touched: the `--json` key is unconditional
      // because a consumer branches on a value, a person on a line.
      expect(text.stdout).not.toContain(SERVICE_VIEWS);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("grades one `subsystem.views-stale` per file, each naming its own — and one sync clears both", async () => {
    const p = await makeProject(nestedFixture());
    try {
      const stale = subsystemFindings((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(stale.map((f) => f.code)).toEqual(["subsystem.views-stale", "subsystem.views-stale"]);
      expect(stale.map((f) => f.subject).sort()).toEqual([SERVICE_VIEWS, SUBSYSTEM_VIEWS]);
      // One code covers two files only because each message names the file it
      // is about; the repair is the same command for both, which is what makes
      // the shared code honest rather than merely economical.
      for (const finding of stale) expect(finding.message).toContain("loam subsystem sync");
      expect(stale.find((f) => f.subject === SERVICE_VIEWS)!.message).toContain(SERVICE_VIEWS);

      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      const after = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(subsystemFindings(after.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("an edge added to the MAP restales the per-service file alone", async () => {
    // The two files are graded apart because they drift apart: the subsystem
    // views are a function of the TREE (and the map's element join), while a
    // per-service view names every peer the map draws an edge to. One new edge
    // is therefore exactly one stale file, and a folded answer would have said
    // "the generated views changed" and left a reader to diff for which.
    const p = await makeProject(nestedFixture());
    try {
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      const subsystems = await p.read(SUBSYSTEM_VIEWS);
      const map = await p.read("architecture/landscape.likec4");
      await p.write(
        "architecture/landscape.likec4",
        map.replace("  customer -> checkoutWeb 'Uses'", "  customer -> checkoutWeb 'Uses'\n  customer -> paymentService 'Calls'"),
      );

      const stale = subsystemFindings((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(stale.map((f) => f.subject)).toEqual([SERVICE_VIEWS]);

      const repair = JSON.parse((await runLoam(p.workDir, "subsystem", "sync", "--json")).stdout);
      expect(repair.action).toBe("current");
      expect(repair.serviceViews.action).toBe("updated");
      // The untouched file is untouched, byte for byte.
      expect(await p.read(SUBSYSTEM_VIEWS)).toBe(subsystems);
      // …and the new peer is drawn, named as the map declares the endpoint.
      expect(await p.read(SERVICE_VIEWS)).toContain("    include customer\n");
      expect(subsystemFindings((await runLoam(p.workDir, "validate", "--all", "--json")).stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("a subsystem VERB lands the per-service file in its own commit — the title carries the placement", async () => {
    // `subsystem move` changes where a service is filed, and a per-service view
    // is titled `<subsystem path> / <service id>`. Leaving that file for a later
    // `sync` is the "failing between two commits" state the shared commit window
    // exists to refuse, so the verb writes it and says so.
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "title: Payments\n";
    const p = await makeProject(files);
    try {
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      expect(await p.read(SERVICE_VIEWS)).toContain("    title 'payment-service'\n");

      const moved = await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "payments", "--json");
      expect(moved.code, moved.stdout).toBe(0);
      const payload = JSON.parse(moved.stdout);
      expect(payload.views).toBe("updated");
      expect(payload.serviceViews).toBe("updated");
      expect(await p.read(SERVICE_VIEWS)).toContain("    title 'Payments / payment-service'\n");
      // The commit that moved the directory is the commit that fixed the file.
      expect(subsystemFindings((await runLoam(p.workDir, "validate", "--all", "--json")).stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("an unreadable map never DELETES the per-service file — neither sync nor a verb", async () => {
    // The sharper half of the `blocked` rule, and the reason `known` is threaded
    // all the way down. `renderSubsystemViews` answers null off the TREE, which
    // is readable whatever the map says; `renderServiceOverviews` answers null
    // whenever no service resolves to an element — which is exactly what an
    // unreadable map looks like from the render. So for THIS file "must be
    // absent" and "loam could not read the map" are the same bytes, and a writer
    // that took the second for the first would delete the whole file over a
    // sibling document that does not parse.
    const p = await makeProject(nestedFixture());
    try {
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      const before = await p.read(SERVICE_VIEWS);
      await p.write("architecture/landscape.likec4", "specification { element softwareSystem\nmodel {\n");

      const json = JSON.parse((await runLoam(p.workDir, "subsystem", "sync", "--json")).stdout);
      expect(json.action).toBe("blocked");
      expect(json.serviceViews).toEqual({ path: SERVICE_VIEWS, action: "blocked" });
      expect(await p.read(SERVICE_VIEWS)).toBe(before);
      const text = await runLoam(p.workDir, "subsystem", "sync");
      expect(text.stdout).toContain(`${SERVICE_VIEWS} left as it is`);

      // A VERB may not decline the subsystem file — its bytes carry the tree it
      // just changed — but it must decline this one for the reason above, and a
      // `subsystem new` beside a broken map must leave it exactly as it is.
      const made = await runLoam(p.workDir, "subsystem", "new", "later", "--json");
      expect(made.code, made.stdout).toBe(0);
      expect(JSON.parse(made.stdout).serviceViews).toBe("current");
      expect(await p.read(SERVICE_VIEWS)).toBe(before);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("every project read drops BOTH generated documents — a broken one blanks nothing", async () => {
    // The generalisation from one hard-coded name to a SET, proved where it
    // matters: `architecture/` is loaded as one project by the map's own grade,
    // by `subsystem sync`'s render and by the renderer's-eye fleet load, and a
    // views-only document does not parse standalone. A reader that kept this
    // file would report the fleet's whole map unreadable over bytes no check
    // may read in the first place (docs/DESIGN.md rule 26).
    const p = await makeProject(nestedFixture());
    try {
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      // The hand edit KEEPS loam's own header, and that is what makes it an edit
      // of a generated file rather than somebody's authored document standing at
      // a reserved path — the case in the next test, where sync refuses instead
      // of repairing. The two are told apart by the first line and by nothing
      // else.
      await p.write(
        SERVICE_VIEWS,
        `${GENERATED_MARK} — one overview view per service under services/, drawn from the fleet map.\n` +
          "views {\n  view service_broken of nothing.at.all {\n    include *\n  }\n}\n",
      );
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const codes = (JSON.parse(res.stdout) as { targets: Array<{ findings: Finding[] }> }).targets
        .flatMap((t) => t.findings)
        .map((f) => f.code);
      // The map still parses and every service still grades: the ONE thing said
      // about the file is that it does not match — never that it does not parse,
      // which nothing here ever asked.
      expect(codes).not.toContain("landscape.invalid");
      expect(codes).not.toContain("c4.fleet-project-invalid");
      // And the element join survived, which is the load-bearing half: the OTHER
      // generated file is graded current, and it can only be rendered from a
      // project read that dropped the broken document and kept the map.
      expect(subsystemFindings(res.stdout).map((f) => f.subject)).toEqual([SERVICE_VIEWS]);
      // And one sync takes the hand edit back out.
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      expect(subsystemFindings((await runLoam(p.workDir, "validate", "--all", "--json")).stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);
  it("refuses a file it did NOT write at either generated path, and the bytes survive", async () => {
    // Both of these are filenames loam RESERVES inside `architecture/`, which is
    // a directory the team owns, and sync rewrites both files whole. A repository
    // that already kept a hand-authored diagram at one of those paths would have
    // lost it on the first sync after the release that reserved the name —
    // silently, with nothing to restore it from. That breaks the one promise the
    // rest of the tree keeps (archive's verbatim splice: authored bytes stay
    // authored), so the writer asks the file who wrote it, and the answer is the
    // first line. One predicate, one sentence, both files.
    const authored = "// our own overview, hand-drawn, here long before loam.\nviews {\n  view ours {\n    include *\n  }\n}\n";
    for (const path of [SUBSYSTEM_VIEWS, SERVICE_VIEWS]) {
      const other = path === SUBSYSTEM_VIEWS ? SERVICE_VIEWS : SUBSYSTEM_VIEWS;
      const p = await makeProject(nestedFixture());
      try {
        expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
        await p.write(path, authored);
        const before = await treeHashes(p.docsDir);

        const res = await runLoam(p.workDir, "subsystem", "sync", "--json");
        // NOT a clean run: this command in a hook or a CI step must not report
        // success over a file it can never repair, because `validate --all` goes
        // on reporting `subsystem.views-stale` for that path and naming this
        // very command as the fix.
        expect(res.code, res.stdout).toBe(1);
        const payload = JSON.parse(res.stdout) as { action: string; serviceViews: { action: string } };
        const actions: Record<string, string> = {
          [SUBSYSTEM_VIEWS]: payload.action,
          [SERVICE_VIEWS]: payload.serviceViews.action,
        };
        expect(actions[path]).toBe("refused");
        // The refusal is about ONE file. The other generated file is still
        // loam's, and is still answered for on the same run.
        expect(actions[other]).toBe("current");
        // Byte for byte — and nothing else in the tree moved either, which is
        // what `treeHashes` says that a read of the one file could not.
        expect(await p.read(path)).toBe(authored);
        expect(await treeHashes(p.docsDir)).toEqual(before);

        const text = await runLoam(p.workDir, "subsystem", "sync");
        expect(text.code).toBe(1);
        expect(text.stdout).toContain(`${path} left as it is`);
        // The sentence names what loam looked for and how to get out of the
        // loop; a refusal a person cannot act on is a worse failure than the
        // clobber it prevents.
        expect(text.stdout).toContain(GENERATED_MARK);
        expect(text.stdout).toContain("subsystem.views-stale");
        expect(await treeHashes(p.docsDir)).toEqual(before);

        // And the repair the message names really works: the path is loam's
        // again the moment the authored file is out of it, with no other step.
        await rm(join(p.docsDir, path));
        const repaired = await runLoam(p.workDir, "subsystem", "sync", "--json");
        expect(repaired.code, repaired.stdout).toBe(0);
        expect(p.exists(path)).toBe(true);
        expect(subsystemFindings((await runLoam(p.workDir, "validate", "--all", "--json")).stdout)).toEqual([]);
      } finally {
        await p.destroy();
      }
    }
  }, 120_000);
});

/**
 * The hole the guard left when it lived in `sync` alone.
 *
 * `sync` is one of FIVE writers of these two reserved paths. The other four
 * subsystem verbs share one commit window (`commands/subsystem/txn/txn.ts`) and
 * wrote the pair with no ownership check at all: reproduced, with a
 * hand-authored `architecture/services.likec4` in the tree, `loam subsystem new
 * platform` printed "architecture/services.likec4 updated" and destroyed it —
 * the file's digest changed and its first line became loam's header.
 *
 * The verbs refuse WHOLE rather than reporting the one file, and that is the
 * deliberate difference from `sync`: their contract is that the generated file
 * lands in the SAME commit as the change to the tree, so completing the
 * structural half would manufacture the `subsystem.views-stale` state the window
 * exists never to leave between two commits — and `move` and `rename` would
 * additionally leave renames staged in git that nobody asked for.
 */
const AUTHORED = "// our own overview, hand-drawn, here long before loam.\nviews {\n  view ours {\n    include *\n  }\n}\n";

/** `nestedFixture()` plus an EMPTY subsystem, so `subsystem rm` gets past its own refusal to the window. */
function verbFixture(): Record<string, string> {
  const files = nestedFixture();
  files["services/spare/subsystem.yaml"] = "title: Spare\n";
  return files;
}

describe("a subsystem VERB refuses whole over a file it did not write", () => {
  it.each([
    ["new", ["subsystem", "new", "platform"]],
    ["rm", ["subsystem", "rm", "spare"]],
    ["move", ["subsystem", "move", "payment-service", "--into", "."]],
    ["rename", ["subsystem", "rename", "payments", "cash"]],
  ])("%s refuses already-exists, writes nothing, and moves not one directory", async (_verb, args) => {
    const p = await makeProject(verbFixture());
    try {
      // Sync first, so BOTH generated files are loam's and current: the only
      // thing this run changes is that one of them is replaced by an authored
      // document, which is the whole variable under test.
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      await p.write(SERVICE_VIEWS, AUTHORED);
      const before = await treeHashes(p.docsDir);

      const res = await runLoam(p.workDir, ...args, "--json");
      expect(res.code, res.stdout).toBe(1);
      const payload = JSON.parse(res.stdout) as { ok: boolean; error: { code: string; message: string } };
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe("already-exists");
      // The SAME sentence `sync` prints, from the one place it is composed —
      // a person who has met this refusal once must recognise it here.
      expect(payload.error.message).toContain(`${SERVICE_VIEWS} left as it is`);
      expect(payload.error.message).toContain(GENERATED_MARK);
      // And the clause that is this refusal's own: the structural change did
      // NOT happen either.
      expect(payload.error.message).toContain("nothing was renamed");

      // Byte for byte, and the whole tree with it: no marker created, no
      // directory renamed, no other generated file rewritten.
      expect(await p.read(SERVICE_VIEWS)).toBe(AUTHORED);
      expect(await treeHashes(p.docsDir)).toEqual(before);

      // The repair the message names works, with no other step: the verb runs.
      await rm(join(p.docsDir, SERVICE_VIEWS));
      expect((await runLoam(p.workDir, ...args)).code, args.join(" ")).toBe(0);
    } finally {
      await p.destroy();
    }
  }, 120_000);

  it("guards the OTHER reserved path too — one predicate, both files, every verb", async () => {
    const p = await makeProject(verbFixture());
    try {
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      await p.write(SUBSYSTEM_VIEWS, AUTHORED);
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "subsystem", "new", "platform", "--json");
      expect(res.code, res.stdout).toBe(1);
      expect(JSON.parse(res.stdout).error.message).toContain(`${SUBSYSTEM_VIEWS} left as it is`);
      expect(await p.read(SUBSYSTEM_VIEWS)).toBe(AUTHORED);
      expect(await treeHashes(p.docsDir)).toEqual(before);
      // Nothing was created — a marker without its view is exactly the state
      // the commit window refuses to leave between two commits.
      expect(p.exists("services/platform/subsystem.yaml")).toBe(false);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});
