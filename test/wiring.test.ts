/**
 * How eleven repositories are wired together: one shared docs repo and ten
 * service repos, each carrying a committed loam.json that points at it.
 *
 * Everything else in the suite is measured on top of this wiring, so a failure
 * here invalidates a green run elsewhere: a docsDir that resolves to the wrong
 * place, or a missing docs repo that reads as an empty one, makes every
 * downstream check pass over a repository nobody is looking at.
 *
 * Families:
 *  - docsDir is stored as written, and resolves against the config FILE
 *  - config discovery walks up to the git root
 *  - one config validator: doctor and loadConfig cannot disagree
 *  - init joins an existing docs repo and refuses to invent a second one
 *  - service ids are validated before anything is written
 *  - the scaffold lays down a landscape the parser accepts
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  configPath,
  findConfigPath,
  loadConfig,
  parseConfig,
  saveConfig,
} from "../src/core/envelope/config.js";
import { diagnose } from "../src/core/doctor.js";
import { DOCS_SUBDIRS, scaffoldDocs } from "../src/core/docs.js";
import { listFeatures, listServices } from "../src/core/repo.js";
import { loadFile } from "../src/core/c4/likec4.js";
import { LikeC4 } from "likec4";
import { makeTmpDir, runLoam, writeFiles } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** A throwaway directory that is cleaned up after the test. */
async function tmp(prefix = "loam-wiring-"): Promise<string> {
  const dir = await makeTmpDir(prefix);
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * The shape the campaign is about: a docs repo and a service repo side by side
 * under one root, the way ten service repos sit beside one docs repo.
 */
async function fleetRoot(): Promise<{ root: string; docs: string; svc: string }> {
  const root = await tmp();
  const docs = join(root, "docs");
  const svc = join(root, "payment-service");
  await mkdir(svc, { recursive: true });
  await scaffoldDocs(docs);
  return { root, docs, svc };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* 1. docsDir is stored exactly as it was passed                       */
/* ------------------------------------------------------------------ */

describe("init stores docsDir the way the caller wrote it", () => {
  it("keeps a relative --docs relative in the committed config", async () => {
    const { docs, svc } = await fleetRoot();
    const res = await runLoam(svc, "init", "--docs", "../docs", "--service", "payment-service");

    expect(res.code).toBe(0);
    expect(await readJson(join(svc, "loam.json"))).toMatchObject({
      docsDir: "../docs",
      service: "payment-service",
    });
    // and it still resolves to the real docs repo from that repo
    const config = await loadConfig(svc);
    expect(config?.docsDir).toBe(resolve(docs));
  });

  it("resolves against the config FILE, so a moved checkout finds its own neighbour", async () => {
    // The bug: an absolute docsDir baked into a committed loam.json names a
    // directory that exists on exactly one machine. Copy the pair somewhere
    // else and the config must follow the copy, not the original.
    const first = await fleetRoot();
    await runLoam(first.svc, "init", "--docs", "../docs", "--service", "payment-service");

    const elsewhere = await tmp("loam-wiring-moved-");
    await cp(first.root, elsewhere, { recursive: true });
    const movedSvc = join(elsewhere, "payment-service");

    const config = await loadConfig(movedSvc);
    expect(config?.docsDir).toBe(join(elsewhere, "docs"));
    expect(config?.docsDir).not.toBe(resolve(first.docs));
  });

  it("stores an absolute --docs absolute — an explicit choice is honoured", async () => {
    const { docs, svc } = await fleetRoot();
    const res = await runLoam(svc, "init", "--docs", docs);

    expect(res.code).toBe(0);
    expect((await readJson(join(svc, "loam.json"))).docsDir).toBe(docs);
  });

  it("tells the caller that loam.json is committed and what docsDir it stored", async () => {
    const { svc } = await fleetRoot();
    const res = await runLoam(svc, "init", "--docs", "../docs");

    expect(res.out).toContain("../docs");
    expect(res.out).toContain("commit loam.json");
  });

  it("reports both spellings in the envelope: resolved for machines, stored for the file", async () => {
    const { docs, svc } = await fleetRoot();
    const res = await runLoam(svc, "init", "--docs", "../docs", "--json");

    const json = JSON.parse(res.stdout);
    // realpaths: process.chdir resolves the tmpdir symlink on macOS
    expect(await realpath(json.docsDir)).toBe(await realpath(docs));
    expect(json.docsDirStored).toBe("../docs");
  });
});

/* ------------------------------------------------------------------ */
/* 5. config discovery walks up to the git root                        */
/* ------------------------------------------------------------------ */

describe("config discovery walks up the tree", () => {
  it("finds the repo-root loam.json from a deep subdirectory", async () => {
    const { docs, svc } = await fleetRoot();
    await runLoam(svc, "init", "--docs", "../docs", "--service", "payment-service");
    const deep = join(svc, "src", "deep");
    await mkdir(deep, { recursive: true });

    expect(findConfigPath(deep)).toBe(join(svc, "loam.json"));
    const config = await loadConfig(deep);
    expect(config?.docsDir).toBe(resolve(docs));
    // the repo root is where the file is, not where the caller was standing
    expect(config?.root).toBe(resolve(svc));
  });

  it("stops at the git root — a config in an outer directory is not this repo's", async () => {
    const outer = await tmp();
    const repo = join(outer, "repo");
    const deep = join(repo, "src", "deep");
    await mkdir(deep, { recursive: true });
    // `.git` marks the repo boundary (a file, as in a worktree, counts too)
    await writeFile(join(repo, ".git"), "gitdir: elsewhere\n", "utf8");
    await writeFile(join(outer, "loam.json"), JSON.stringify({ docsDir: "." }) + "\n", "utf8");

    expect(findConfigPath(deep)).toBeNull();
    expect(await loadConfig(deep)).toBeNull();
    // configPath stays total: it names where a config would have to be written
    expect(configPath(deep)).toBe(join(deep, "loam.json"));
  });

  it("init refuses to write a second config under one that already governs, unless forced", async () => {
    const { svc } = await fleetRoot();
    await runLoam(svc, "init", "--docs", "../docs", "--service", "payment-service");
    const deep = join(svc, "src", "deep");
    await mkdir(deep, { recursive: true });

    const refused = await runLoam(deep, "init", "--docs", "../../../docs", "--json");
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout).error.code).toBe("already-exists");
    expect(existsSync(join(deep, "loam.json"))).toBe(false);

    const forced = await runLoam(deep, "init", "--docs", "../../../docs", "--force", "--json");
    expect(forced.code).toBe(0);
    expect(existsSync(join(deep, "loam.json"))).toBe(true);
    // --force does not inherit the outer repo's binding
    expect(await readJson(join(deep, "loam.json"))).not.toHaveProperty("service");
  });

  it("a docs repo carries its own loam.json, so commands run from inside it work", async () => {
    const { docs } = await fleetRoot();
    const config = await loadConfig(join(docs, "services"));
    expect(config?.docsDir).toBe(resolve(docs));
  });
});

/* ------------------------------------------------------------------ */
/* 4. one config validator                                             */
/* ------------------------------------------------------------------ */

describe("doctor and loadConfig cannot disagree about a config", () => {
  /**
   * The invariant, not an example of it: for every config below, `loam doctor`
   * calling the file valid and `loadConfig` returning a config must be the same
   * answer. Two validators are two opinions, and doctor's used to be the
   * friendlier one — it accepted a gherkinDir every command refused.
   */
  const configs: Array<{ name: string; raw: string; valid: boolean }> = [
    { name: "a plain valid config", raw: JSON.stringify({ docsDir: "../docs" }), valid: true },
    {
      name: "a valid config with a bound service and gherkinDir",
      raw: JSON.stringify({ docsDir: "../docs", service: "payment-service", gherkinDir: "features" }),
      valid: true,
    },
    {
      name: "gherkinDir escaping the service repo",
      raw: JSON.stringify({ docsDir: "../docs", gherkinDir: "../shared" }),
      valid: false,
    },
    { name: "service that is not a string", raw: JSON.stringify({ docsDir: "../docs", service: 123 }), valid: false },
    { name: "service that is a path", raw: JSON.stringify({ docsDir: "../docs", service: "../evil" }), valid: false },
    { name: "docsDir that is not a string", raw: JSON.stringify({ docsDir: 5 }), valid: false },
    { name: "docsDir absent", raw: JSON.stringify({ service: "payment-service" }), valid: false },
    { name: "a JSON scalar, not an object", raw: "5", valid: false },
    { name: "JSON null", raw: "null", valid: false },
    { name: "not JSON at all", raw: "{ nope", valid: false },
  ];

  for (const { name, raw, valid } of configs) {
    it(`agrees on ${name}`, async () => {
      const { svc } = await fleetRoot();
      await writeFile(join(svc, "loam.json"), raw, "utf8");

      const report = await diagnose(svc);
      const loaded = await loadConfig(svc);

      expect(report.config.status).toBe(valid ? "valid" : "invalid");
      expect(loaded !== null).toBe(valid);
      if (!valid) {
        expect(report.findings).toContainEqual(
          expect.objectContaining({ severity: "blocker", code: "doctor.config-invalid" }),
        );
      }
    });
  }

  it("names the file and the field instead of leaking a Node TypeError", async () => {
    const { svc } = await fleetRoot();
    await writeFile(join(svc, "loam.json"), JSON.stringify({ docsDir: 5 }), "utf8");

    const report = await diagnose(svc);
    expect(report.config.error).toContain("loam.json");
    expect(report.config.error).toContain("docsDir");
    expect(report.config.error).not.toContain("TypeError");
  });

  it("parseConfig resolves relative paths against the directory it is given", () => {
    const config = parseConfig(JSON.stringify({ docsDir: "../docs" }), "/repos/payment-service");
    expect(config.docsDir).toBe(resolve("/repos/docs"));
    expect(config.root).toBe(resolve("/repos/payment-service"));
    expect(config.docsDirAsWritten).toBe("../docs");
  });

  it("saveConfig never persists the derived fields it hands out", async () => {
    const dir = await tmp();
    await saveConfig(
      { docsDir: "../docs", root: "/somewhere", docsDirAsWritten: "../docs" },
      dir,
    );
    const stored = await readJson(join(dir, "loam.json"));
    expect(stored).toEqual({ docsDir: "../docs" });
  });
});

/* ------------------------------------------------------------------ */
/* 6. join an existing docs repo, or say --create                      */
/* ------------------------------------------------------------------ */

describe("init distinguishes joining a docs repo from creating one", () => {
  it("refuses a typo instead of scaffolding a second, empty docs repo", async () => {
    const { root, svc } = await fleetRoot();
    const res = await runLoam(svc, "init", "--docs", "../dcos", "--json");

    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.error.code).toBe("invalid-option");
    expect(json.error.message).toContain("--create");
    // nothing was made, and no config was written to remember the mistake
    expect(existsSync(join(root, "dcos"))).toBe(false);
    expect(existsSync(join(svc, "loam.json"))).toBe(false);
  });

  it("refuses a directory that exists but is not a docs repo", async () => {
    const { root, svc } = await fleetRoot();
    await mkdir(join(root, "notdocs"), { recursive: true });
    const res = await runLoam(svc, "init", "--docs", "../notdocs", "--json");

    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.message).toContain("not a docs repo");
  });

  it("--create is what makes a new docs repo", async () => {
    const { root, svc } = await fleetRoot();
    const res = await runLoam(svc, "init", "--docs", "../fresh", "--create", "--json");

    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.docsRepo).toBe("created");
    for (const sub of ["architecture", "services", "features", "AGENTS.md"]) {
      expect(existsSync(join(root, "fresh", sub))).toBe(true);
    }
  });

  it("joins an existing docs repo without rewriting it, and says how big the fleet is", async () => {
    const { docs, svc } = await fleetRoot();
    await writeFiles(docs, {
      "services/payment-service/spec.md": "# payment-service\n",
      "services/checkout-web/spec.md": "# checkout-web\n",
    });
    const marker = join(docs, "AGENTS.md");
    const before = await readFile(marker, "utf8");

    const res = await runLoam(svc, "init", "--docs", "../docs", "--service", "payment-service");

    expect(res.code).toBe(0);
    expect(res.out).toContain("pointing at existing docs repo (2 services)");
    expect(await readFile(marker, "utf8")).toBe(before);
    // nothing under the docs repo was created — only this repo's own files
    expect(res.out).not.toContain(join(docs, "architecture"));
  });
});

/* ------------------------------------------------------------------ */
/* 7. service ids are validated once, before anything is written        */
/* ------------------------------------------------------------------ */

describe("service ids are validated before anything is written", () => {
  it("refuses a --service that would escape services/", async () => {
    const { svc } = await fleetRoot();
    const res = await runLoam(svc, "init", "--docs", "../docs", "--service", "../evil");

    expect(res.code).toBe(1);
    expect(res.out).toContain("service id");
    expect(existsSync(join(svc, "loam.json"))).toBe(false);
  });

  it("refuses a --service with a path separator, inside the envelope", async () => {
    const { svc } = await fleetRoot();
    const res = await runLoam(svc, "init", "--docs", "../docs", "--service", "a/b", "--json");

    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
    expect(existsSync(join(svc, "loam.json"))).toBe(false);
  });

  it("accepts the ids a real fleet uses", async () => {
    for (const id of ["payment-service", "checkout_web", "svc.v2", "a1"]) {
      const { svc } = await fleetRoot();
      const res = await runLoam(svc, "init", "--docs", "../docs", "--service", id);
      expect(res.code, id).toBe(0);
      expect((await readJson(join(svc, "loam.json"))).service).toBe(id);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 8. the scaffold lays down a landscape and the docs repo's config     */
/* ------------------------------------------------------------------ */

describe("scaffoldDocs writes a fleet map the parser accepts", () => {
  it("creates architecture/landscape.likec4 and it parses clean", async () => {
    const docs = join(await tmp(), "docs");
    await scaffoldDocs(docs);

    const path = join(docs, "architecture", "landscape.likec4");
    expect(existsSync(path)).toBe(true);
    const doc = await loadFile(path);
    expect(doc.errors).toEqual([]);
  });

  it("creates the docs repo's own loam.json pointing at itself", async () => {
    const docs = join(await tmp(), "docs");
    await scaffoldDocs(docs);

    expect(await readJson(join(docs, "loam.json"))).toEqual({ docsDir: "." });
  });

  it("overwrites nothing on a second run", async () => {
    const docs = join(await tmp(), "docs");
    await scaffoldDocs(docs);
    const landscape = join(docs, "architecture", "landscape.likec4");
    await writeFile(landscape, "// ours\nspecification { element person }\nmodel {}\n", "utf8");
    await writeFile(join(docs, "loam.json"), '{"docsDir": "./"}\n', "utf8");

    const second = await scaffoldDocs(docs);

    expect(second.created).toEqual([]);
    expect(await readFile(landscape, "utf8")).toContain("// ours");
    expect(await readFile(join(docs, "loam.json"), "utf8")).toContain('"./"');
  });
});

/* ------------------------------------------------------------------ */
/* 8b. the scaffold survives a clone, and a renderer can read it        */
/* ------------------------------------------------------------------ */

/**
 * Two ways a freshly created docs repo was not yet a repository anyone else
 * could use.
 *
 * The first is git's oldest gotcha: `services/` and `features/` are created
 * empty, git tracks files and not directories, so after the first push neither
 * existed for anybody who cloned. A missing `services/` is a BLOCKER in doctor,
 * not a warning — so the second person to touch the repo got a red preflight on
 * a repository the first person left green.
 *
 * The second is that the tree was not a loadable LikeC4 workspace at all. loam
 * parses every `.likec4` file alone, so each declares its own `specification`
 * block and re-declares the elements it names; LikeC4's own loader merges the
 * whole tree into one model, and pointing `npx likec4 start` at the repo root —
 * which loam's own brief recommends — reported every declaration as a
 * duplicate. On loam's four-file `examples/docs`: 16 errors from the renderer,
 * 0 from `loam validate --all`.
 */
describe("a scaffolded docs repo survives being cloned and rendered", () => {
  it("keeps the empty directories in version control", async () => {
    const docs = join(await tmp(), "docs");
    await scaffoldDocs(docs);

    expect(existsSync(join(docs, "services", ".gitkeep"))).toBe(true);
    expect(existsSync(join(docs, "features", ".gitkeep"))).toBe(true);
    // and the marker is invisible to the enumerations, which walk subdirectories
    expect(await listServices(docs)).toEqual([]);
    expect(await listFeatures(docs)).toEqual([]);
  });

  it("declares one LikeC4 project scoped to the landscape", async () => {
    const docs = join(await tmp(), "docs");
    await scaffoldDocs(docs);

    const config = await readJson(join(docs, "likec4.config.json")) as {
      name: string;
      exclude: string[];
    };
    expect(config.name).toBe("fleet");
    // Every directory in which loam expects a SECOND .likec4 file has to be out
    // of the root project, or the merge that project performs is the bug.
    expect(config.exclude).toContain("services/**");
    expect(config.exclude).toContain("features/**");
    // naming `exclude` replaces LikeC4's default rather than adding to it
    expect(config.exclude).toContain("**/node_modules/**");
  });

  it("excludes every directory loam writes a .likec4 into, landscape aside", async () => {
    // The invariant, asked of the layout rather than of a list written twice:
    // architecture/ holds the one file the root project is FOR, and anything
    // else loam models has to be excluded from it.
    const docs = join(await tmp(), "docs");
    await scaffoldDocs(docs);
    const { exclude } = await readJson(join(docs, "likec4.config.json")) as { exclude: string[] };

    for (const dir of DOCS_SUBDIRS) {
      const excluded = exclude.includes(`${dir}/**`);
      expect(excluded, `${dir}/ must ${dir === "architecture" ? "not " : ""}be excluded`)
        .toBe(dir !== "architecture");
    }
  });

  it("loads as ONE workspace under LikeC4's real loader, where it used not to", async () => {
    // The proof, taken from the tool that reports the bug rather than from the
    // shape of the config file. Two services whose models legitimately declare
    // the same element kinds and re-declare a shared broker — the ordinary case,
    // not a contrived one — plus the landscape that names them both.
    const docs = join(await tmp(), "docs");
    await scaffoldDocs(docs);
    const model = (id: string, el: string): string =>
      `specification {\n  element softwareSystem\n  element container\n}\n\n` +
      `model {\n  ${el} = softwareSystem '${id}' {\n    metadata { service '${id}' }\n  }\n` +
      `  kafka = softwareSystem 'Kafka'\n  ${el} -> kafka 'Publishes'\n}\n`;
    await writeFiles(docs, {
      "services/svc-a/model.likec4": model("svc-a", "svcA"),
      "services/svc-b/model.likec4": model("svc-b", "svcB"),
    });

    const load = async (): Promise<number> => {
      const lc4 = await LikeC4.fromWorkspace(docs, { logger: false, throwIfInvalid: false });
      return lc4.getErrors().length;
    };

    expect(await load()).toBe(0);

    // and without the project file it is the tree that shipped: every
    // `specification` block and every re-declared element read as a duplicate.
    await rm(join(docs, "likec4.config.json"));
    expect(await load()).toBeGreaterThan(0);
  });

  it("doctor names the missing project file, with the bytes to write, on a repo that predates it", async () => {
    const docs = join(await tmp(), "docs");
    await scaffoldDocs(docs);
    await rm(join(docs, "likec4.config.json"));
    const work = await tmp();
    await writeFile(join(work, "loam.json"), JSON.stringify({ docsDir: docs }), "utf8");

    const finding = (await diagnose(work)).findings.find((f) => f.code === "doctor.likec4-config-missing");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("warning");
    // the fix is the file itself, not a description of it
    expect(finding!.fix).toContain('"name": "fleet"');
    expect(finding!.fix).toContain('"services/**"');

    // and it is quiet once the file is back
    await scaffoldDocs(docs);
    expect((await diagnose(work)).findings.map((f) => f.code))
      .not.toContain("doctor.likec4-config-missing");
  });
});

/* ------------------------------------------------------------------ */
/* 9. doctor names the fix and actually reads the landscape             */
/* ------------------------------------------------------------------ */

describe("doctor names the next step and reads what it reports on", () => {
  it("every blocking finding carries a non-empty fix", async () => {
    const dir = await tmp();
    // no config at all: the most blocked a repo can be
    const report = await diagnose(dir);
    expect(report.healthy).toBe(false);
    for (const finding of report.findings.filter((f) => f.severity === "blocker")) {
      expect(finding.fix, finding.code).not.toBe("");
    }
    expect(report.findings.find((f) => f.code === "doctor.config-missing")?.fix)
      .toContain("loam init");
  });

  it("points a missing docs repo at the config it has to be fixed in", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "loam.json"), JSON.stringify({ docsDir: "./nope" }), "utf8");

    const report = await diagnose(dir);
    const finding = report.findings.find((f) => f.code === "doctor.docs-missing");
    expect(finding?.fix).toContain(join(dir, "loam.json"));
  });

  it("names the binding command when no service is bound", async () => {
    const { svc } = await fleetRoot();
    await writeFile(join(svc, "loam.json"), JSON.stringify({ docsDir: "../docs" }), "utf8");

    const report = await diagnose(svc);
    expect(report.findings.find((f) => f.code === "doctor.service-unbound")?.fix)
      .toContain("--service <id>");
  });

  it("blocks on a landscape left full of merge conflict markers", async () => {
    // Ten people adopting ten services into one landscape.likec4 in one week is
    // the shape of this campaign, so this is the expected onboarding accident.
    const { docs, svc } = await fleetRoot();
    await writeFile(join(svc, "loam.json"), JSON.stringify({ docsDir: "../docs" }), "utf8");
    await writeFile(
      join(docs, "architecture", "landscape.likec4"),
      [
        "specification {",
        "  element softwareSystem",
        "}",
        "",
        "model {",
        "<<<<<<< HEAD",
        "  a = softwareSystem 'a'",
        "=======",
        "  b = softwareSystem 'b'",
        ">>>>>>> theirs",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await runLoam(svc, "doctor", "--json");
    expect(res.code).toBe(1);
    const report = JSON.parse(res.stdout);
    expect(report.healthy).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ severity: "blocker", code: "doctor.landscape-merge-conflict" }),
    );
  });

  it("blocks on a landscape that does not parse — stat'ing the file is not reading it", async () => {
    const { docs, svc } = await fleetRoot();
    await writeFile(join(svc, "loam.json"), JSON.stringify({ docsDir: "../docs" }), "utf8");
    await writeFile(
      join(docs, "architecture", "landscape.likec4"),
      "specification { element softwareSystem }\nmodel { a = notAKind 'a' }\n",
      "utf8",
    );

    const report = await diagnose(svc);
    expect(report.docs.landscape).toBe(true);
    expect(report.healthy).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ severity: "blocker", code: "doctor.landscape-invalid" }),
    );
  });

  it("warns about an absolute docsDir in a committed config", async () => {
    const { docs, svc } = await fleetRoot();
    await writeFile(join(svc, "loam.json"), JSON.stringify({ docsDir: docs }), "utf8");

    const report = await diagnose(svc);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "doctor.docs-absolute" }),
    );
    // it is a warning, not a blocker: it works, just not for anybody else
    expect(report.healthy).toBe(true);
  });

  it("does not warn about the docs repo's own config, whose docsDir is itself", async () => {
    const { docs } = await fleetRoot();
    const report = await diagnose(docs);
    expect(report.findings.map((f) => f.code)).not.toContain("doctor.docs-absolute");
  });

  it("the scaffolded pair is healthy end to end", async () => {
    const { svc } = await fleetRoot();
    await runLoam(svc, "init", "--docs", "../docs", "--service", "payment-service");

    const report = await diagnose(svc);
    expect(report.findings.filter((f) => f.severity === "blocker")).toEqual([]);
    expect(report.healthy).toBe(true);
    // the landscape the scaffold wrote is present and parses
    expect(report.docs.landscape).toBe(true);
    expect(report.findings.map((f) => f.code)).not.toContain("doctor.landscape-missing");
  });
});
