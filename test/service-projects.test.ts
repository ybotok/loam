/**
 * The per-service LikeC4 project file, end to end: `loam subsystem sync`
 * creates `services/<…>/<id>/likec4.config.json` beside every `model.likec4`
 * — create-only, gated on the root project file — and the renderer opened at
 * the docs root then loads one project per service beside `fleet`.
 *
 * Three properties are the contract and are pinned here whole: the bytes are
 * a function of the id alone (so a `subsystem move` needs no rewrite and a
 * second sync is `current`); a file that already exists is the team's and is
 * never touched; and without the root file nothing is written and sync says
 * where the root file comes from. The renderer's own loader stands in for
 * the renderer once, on `test/wiring.test.ts`'s idiom — loam reads none of
 * these files, so nothing else would catch a project the renderer refuses.
 */
import { describe, expect, it } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { LikeC4 } from "likec4";
import { LIKEC4_PROJECT_CONFIG } from "../src/core/docs.js";
import { LIKEC4_ROOT_PROJECT } from "../src/core/repo/paths.js";
import { renderServiceProject, serviceProjectName } from "../src/core/repo/tree/render/projects.js";
import { DOCS_LOCK } from "../src/core/staging/lock.js";
import { coherentFixture, makeProject, runLoam, SERVICE_MODEL, treeHashes } from "./helpers/harness.js";

interface ExcludePayload {
  updated: boolean;
  entries: string[];
  added: string[];
  removed: string[];
  /** loam could not read an `exclude` list out of the root file — never the same answer as `entries: []`. */
  unreadable: boolean;
}

interface SyncPayload {
  ok: boolean;
  action: string;
  subsystems: number;
  projects: { root: boolean; created: string[]; removed: string[]; current: number; exclude: ExcludePayload };
}

const PAYMENT_FILE = "services/payment-service/likec4.config.json";
const BILLING_FILE = "services/platform/billing.core/likec4.config.json";
const PAYMENT_EXCLUDE = "services/payment-service/**";
const BILLING_EXCLUDE = "services/platform/billing.core/**";

/** The scaffold's two non-`services/` entries, which every rewrite keeps in order. */
const SCAFFOLD_EXCLUDE = ["**/node_modules/**", "features/**"];

/** Nothing read, nothing written — the answer for a run with no root project file. */
const NO_EXCLUDE: ExcludePayload = { updated: false, entries: [], added: [], removed: [], unreadable: false };

/** A model for a second service, parsable alone, whose id carries a `.` the project-name grammar refuses. */
const BILLING_MODEL = SERVICE_MODEL.replace(/paymentService/g, "billingCore").replace(/payment-service/g, "billing.core");

/**
 * `coherentFixture()` plus the root project file, a FILED second service with
 * a model under `services/platform/`, and a spec-only service with no model.
 */
function projectsFixture(): Record<string, string> {
  return {
    ...coherentFixture(),
    "likec4.config.json": LIKEC4_PROJECT_CONFIG,
    "services/platform/subsystem.yaml": "title: Platform\n",
    "services/platform/billing.core/model.likec4": BILLING_MODEL,
    "services/platform/billing.core/spec.md": "---\nservice: billing.core\nstatus: draft\n---\n\n# billing.core\n",
    "services/checkout-web/spec.md": "---\nservice: checkout-web\nstatus: draft\n---\n\n# checkout-web\n",
  };
}

async function sync(workDir: string): Promise<SyncPayload> {
  const res = await runLoam(workDir, "subsystem", "sync", "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout) as SyncPayload;
}

describe("loam subsystem sync — one LikeC4 project per service model", () => {
  // Catches: a sync that writes nothing for the services, writes at the
  // unfiled `services/<id>/` join instead of the enumerated directory, gets
  // the bytes wrong, or mints a file for a service that has no model.
  it("creates exactly one file per model-bearing service, at its enumerated directory, with the exact bytes", async () => {
    const p = await makeProject(projectsFixture());
    try {
      const payload = await sync(p.workDir);
      expect(payload.ok).toBe(true);
      // Both models declare their own `specification`, so both stand alone: a
      // project file each, AND an exclude entry each — the scaffold no longer
      // ships a blanket `services/**`, so the first sync is what covers them.
      expect(payload.projects).toEqual({
        root: true,
        // SORTED BY PATH — `services/payment-service/…` before
        // `services/platform/…`, which the survey's service-id order
        // (billing.core, payment-service) does not produce.
        created: [PAYMENT_FILE, BILLING_FILE],
        removed: [],
        current: 0,
        exclude: {
          updated: true,
          entries: [...SCAFFOLD_EXCLUDE, PAYMENT_EXCLUDE, BILLING_EXCLUDE],
          added: [PAYMENT_EXCLUDE, BILLING_EXCLUDE],
          removed: [],
          unreadable: false,
        },
      });
      // Two keys, two-space JSON, LF, one trailing newline; the name folds the
      // dot the renderer's grammar refuses, the title is the id verbatim.
      expect(await p.read(PAYMENT_FILE)).toBe('{\n  "name": "payment-service",\n  "title": "payment-service"\n}\n');
      expect(await p.read(BILLING_FILE)).toBe('{\n  "name": "billing-core",\n  "title": "billing.core"\n}\n');
      // No model, no file: a spec-only service is owed nothing.
      expect(p.exists("services/checkout-web/likec4.config.json")).toBe(false);
      // And nowhere else under services/: exactly the two, no more.
      const files = Object.keys(await treeHashes(p.docsDir)).filter((f) => f.endsWith("likec4.config.json"));
      expect(files.sort()).toEqual(["likec4.config.json", BILLING_FILE, PAYMENT_FILE].sort());
    } finally {
      await p.destroy();
    }
  });

  // Catches: a sync that compares or rewrites the file (a second run would
  // answer something other than `current`, or the tree would change).
  it("is idempotent: the second sync answers current, creates nothing, counts both files as current", async () => {
    const p = await makeProject(projectsFixture());
    try {
      await sync(p.workDir);
      const before = await treeHashes(p.docsDir);
      const again = await sync(p.workDir);
      expect(again.action).toBe("current");
      expect(again.projects).toEqual({
        root: true,
        created: [],
        removed: [],
        current: 2,
        // The list already says what this run would write, so the file is left
        // exactly as the first sync formatted it — `entries` still reports it.
        exclude: {
          updated: false,
          entries: [...SCAFFOLD_EXCLUDE, PAYMENT_EXCLUDE, BILLING_EXCLUDE],
          added: [],
          removed: [],
          unreadable: false,
        },
      });
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  // Catches: a sync that rewrites a pre-existing file to loam's bytes, or
  // reports a file it did not create.
  it("never touches a file that already exists — a hand-written project survives byte for byte", async () => {
    const files = projectsFixture();
    files[PAYMENT_FILE] = '{"name":"mine"}';
    const p = await makeProject(files);
    try {
      const payload = await sync(p.workDir);
      expect(payload.projects).toEqual({
        root: true,
        created: [BILLING_FILE],
        removed: [],
        current: 1,
        exclude: {
          updated: true,
          entries: [...SCAFFOLD_EXCLUDE, PAYMENT_EXCLUDE, BILLING_EXCLUDE],
          added: [PAYMENT_EXCLUDE, BILLING_EXCLUDE],
          removed: [],
          unreadable: false,
        },
      });
      expect(await p.read(PAYMENT_FILE)).toBe('{"name":"mine"}');
    } finally {
      await p.destroy();
    }
  });

  // Catches: a sync that writes service projects with no root project file to
  // put them beside, or stays silent about why it wrote none.
  it("writes nothing without the root project file, and names `loam doctor` as where the root file comes from", async () => {
    // Flat on purpose — no subsystem, so no views file either: the tree must
    // not change by a single byte, and `treeHashes` is what says so.
    const files = projectsFixture();
    delete files["likec4.config.json"];
    delete files["services/platform/subsystem.yaml"];
    delete files["services/platform/billing.core/model.likec4"];
    delete files["services/platform/billing.core/spec.md"];
    files["services/billing.core/model.likec4"] = BILLING_MODEL;
    files["services/billing.core/spec.md"] = "---\nservice: billing.core\n---\n\n# billing.core\n";
    const p = await makeProject(files);
    try {
      const before = await treeHashes(p.docsDir);
      const payload = await sync(p.workDir);
      expect(payload.action).toBe("current");
      expect(payload.projects).toEqual({ root: false, created: [], removed: [], current: 0, exclude: NO_EXCLUDE });
      expect(await treeHashes(p.docsDir)).toEqual(before);
      const text = await runLoam(p.workDir, "subsystem", "sync");
      expect(text.code).toBe(0);
      expect(text.stdout).toContain("no likec4.config.json at the docs root");
      expect(text.stdout).toContain("`loam doctor`");
    } finally {
      await p.destroy();
    }
  });

  // Catches: a text report that still claims "nothing to write" on a run that
  // wrote project files, or that omits the count and the `--project` warning.
  it("the text output counts the files it wrote and drops the views sentence's `nothing to write` tail", async () => {
    // Views first, without the root file, so the run under test is the exact
    // case: views current, project files written in the same run.
    const files = projectsFixture();
    delete files["likec4.config.json"];
    const p = await makeProject(files);
    try {
      const first = await runLoam(p.workDir, "subsystem", "sync");
      expect(first.stdout).toContain("wrote architecture/subsystems.likec4 — 1 subsystem view(s).");
      expect(first.stdout).toContain("no likec4.config.json at the docs root");
      await p.write("likec4.config.json", LIKEC4_PROJECT_CONFIG);
      const res = await runLoam(p.workDir, "subsystem", "sync");
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("architecture/subsystems.likec4 is current (1 subsystem(s)).");
      expect(res.stdout).not.toContain("nothing to write");
      expect(res.stdout).toContain("wrote 2 services/<…>/likec4.config.json");
      expect(res.stdout).toContain("--project <name>");
      expect(res.stdout).not.toContain("loam doctor");
    } finally {
      await p.destroy();
    }
  });
});

describe("the project name and bytes", () => {
  // Catches: a name that keeps the `.` the renderer refuses, misses the
  // `fleet`/`default` prefix, or a title that is anything but the id verbatim.
  it.each([
    ["payment-service", "payment-service"],
    ["billing.core", "billing-core"],
    ["a.b.c", "a-b-c"],
    ["fleet", "service-fleet"],
    ["default", "service-default"],
    ["Order_Service", "Order_Service"],
  ])("%s → project %s, title verbatim", (id, name) => {
    expect(serviceProjectName(id, LIKEC4_ROOT_PROJECT)).toBe(name);
    expect(renderServiceProject(id, LIKEC4_ROOT_PROJECT)).toBe(`{\n  "name": "${name}",\n  "title": "${id}"\n}\n`);
  });
});

describe("the renderer reads what sync wrote", () => {
  // Catches: bytes the renderer refuses (a dotted name, a `fleet` collision)
  // or a placement it does not register — loam never parses these files, so
  // the loader is the only reader that can say. Measured at the 1.59.2 pin:
  // a nested project is registered even though the root excludes services/**.
  it("loads fleet plus one project per service model, with zero errors, including the dotted id", async () => {
    const p = await makeProject(projectsFixture());
    try {
      await sync(p.workDir);
      const lc4 = await LikeC4.fromWorkspace(p.docsDir, { logger: false, throwIfInvalid: false });
      try {
        expect(lc4.getErrors()).toEqual([]);
        const ids = lc4.languageServices.projects().map((project) => project.id as string);
        expect(new Set(ids)).toEqual(new Set(["fleet", "payment-service", "billing-core"]));
      } finally {
        await lc4.dispose();
      }
    } finally {
      await p.destroy();
    }
  });
});

describe("placement is not identity", () => {
  // Catches: a sync that spells the path by id at the root (a moved service
  // would be a gap again, and the file would be minted twice), or a move that
  // leaves the file behind.
  it("a moved service carries its file; the next sync is current and creates nothing", async () => {
    const p = await makeProject(projectsFixture());
    try {
      await sync(p.workDir);
      const move = await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "platform", "--json");
      expect(move.code, move.out).toBe(0);
      const after = await sync(p.workDir);
      expect(after.action).toBe("current");
      // The moved service's NEW tree is excluded; its old entry survives,
      // because `standaloneExclude` only drops entries naming a tree the
      // enumeration still holds — the same rule that keeps a team's own
      // `services/legacy/**` over a directory that is not a service.
      expect(after.projects).toEqual({
        root: true,
        created: [],
        removed: [],
        current: 2,
        exclude: {
          updated: true,
          entries: [...SCAFFOLD_EXCLUDE, PAYMENT_EXCLUDE, BILLING_EXCLUDE, "services/platform/payment-service/**"],
          added: ["services/platform/payment-service/**"],
          removed: [],
          unreadable: false,
        },
      });
      expect(await p.read("services/platform/payment-service/likec4.config.json")).toBe(
        '{\n  "name": "payment-service",\n  "title": "payment-service"\n}\n',
      );
      expect(p.exists(PAYMENT_FILE)).toBe(false);
    } finally {
      await p.destroy();
    }
  });
});

describe("one lock, one journal", () => {
  // Catches: a project write that bypasses the docs lock — landing a file
  // while another writer holds the repo.
  it("refuses docs-busy under a held lock and writes no project file", async () => {
    const p = await makeProject(projectsFixture());
    try {
      const before = await treeHashes(p.docsDir);
      // A live pid on this host: the stale-lock break must NOT reclaim it.
      await writeFile(
        join(p.docsDir, DOCS_LOCK),
        JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() }) + "\n",
        "utf8",
      );
      const res = await runLoam(p.workDir, "subsystem", "sync", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("docs-busy");
      expect(p.exists(PAYMENT_FILE)).toBe(false);
      expect(p.exists(BILLING_FILE)).toBe(false);
      await rm(join(p.docsDir, DOCS_LOCK));
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});
