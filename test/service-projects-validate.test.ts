/**
 * The grader's half of the per-service LikeC4 project: `validate --all`
 * warns, once per service, when a `model.likec4` has no `likec4.config.json`
 * beside it — and stays silent in exactly the three states where a finding
 * would be a loop or a lie: no root project file (nothing to sync into), a
 * file already present (create-only means presence is the whole question),
 * and a service with no model (owed nothing).
 *
 * The property worth pinning across the writer and the grader is that they
 * share ONE predicate (`missingProjects` in `core/repo/tree/render/projects.ts`):
 * the gap the grader names is the gap `subsystem sync` fills, so one run of
 * the advertised repair clears every finding. The fixtures below build the
 * generated views file BEFORE the root project file exists, which is the
 * writer's own gate — `sync` writes no service project without the root file
 * — so the fleet reaches `validate --all` with subsystems in place and every
 * project gap still open.
 */
import { describe, expect, it } from "vitest";
import { LIKEC4_PROJECT_CONFIG } from "../src/core/docs.js";
import { LIKEC4_ROOT_PROJECT } from "../src/core/repo/paths.js";
import { renderServiceProject } from "../src/core/repo/tree/render/projects.js";
import { coherentFixture, LANDSCAPE, makeProject, runLoam, SERVICE_MODEL, type Project } from "./helpers/harness.js";

const CODE = "service.likec4-config-missing";

interface JsonFinding {
  severity: string;
  code: string;
  message: string;
  subject?: string;
  locations?: Array<{ path: string; role: string }>;
}

interface Payload {
  valid: boolean;
  summary: { errors: number; warnings: number };
  targets: Array<{ kind: string; id: string; findings: JsonFinding[] }>;
}

function payloadOf(stdout: string): Payload {
  return JSON.parse(stdout) as Payload;
}

/** The finding under test, each with the target it rode — so a finding filed under a service target is visible as such. */
function projectFindings(payload: Payload): Array<{ target: string; finding: JsonFinding }> {
  return payload.targets.flatMap((t) => t.findings.filter((f) => f.code === CODE).map((finding) => ({ target: t.kind, finding })));
}

/** Its mirror for the other shape: an extending model with a project file beside it. */
function strayFindings(payload: Payload): JsonFinding[] {
  return payload.targets.flatMap((t) => t.findings).filter((f) => f.code === "service.likec4-config-stray");
}

/** The two grades that read the ROOT project's `exclude` list. */
function excludeFindings(payload: Payload): JsonFinding[] {
  return payload.targets
    .flatMap((t) => t.findings)
    .filter((f) => f.code === "service.model-excluded" || f.code === "service.model-unexcluded");
}

/** The third reader of that list — the one about the MAP, with the target it rode. */
function mapExcludedFindings(payload: Payload): Array<{ target: string; finding: JsonFinding }> {
  return payload.targets.flatMap((t) =>
    t.findings.filter((f) => f.code === "landscape.excluded").map((finding) => ({ target: t.kind, finding })),
  );
}

/**
 * `coherentFixture()` (payment-service, unfiled, with a model) plus a FILED
 * service with a model under `services/platform/`. The landscape gains one
 * element for the filed service so the fleet map agrees with `services/` and
 * the fleet grades green — which is what lets the tests below pin the exit
 * code as well as the finding.
 */
function fixture(): Record<string, string> {
  const files = coherentFixture();
  files["architecture/landscape.likec4"] = LANDSCAPE.replace(
    "  customer = person 'Customer'\n",
    "  customer = person 'Customer'\n  identityService = softwareSystem 'identity-service'\n",
  );
  files["services/platform/subsystem.yaml"] = "title: Platform\n";
  files["services/platform/identity-service/model.likec4"] = SERVICE_MODEL.replace(/paymentService/g, "identityService").replace(
    /payment-service/g,
    "identity-service",
  );
  files["services/platform/identity-service/spec.md"] = "---\nservice: identity-service\nstatus: draft\n---\n\n# identity-service\n";
  return files;
}

/**
 * The spec-only service, added to `fixture()` on its own: `checkout-web` is
 * already drawn by the harness landscape, so a spec.md and no model makes it
 * the "owed nothing" case. Kept OUT of the shared fixture because a service
 * with no model is `service.no-model`, an error in its own right, and the
 * tests that pin exit 0 must not carry it.
 */
function withSpecOnlyService(files: Record<string, string>): Record<string, string> {
  return { ...files, "services/checkout-web/spec.md": "---\nservice: checkout-web\nstatus: draft\n---\n\n# checkout-web\n" };
}

/**
 * The fixture with its generated views file in place and the root project
 * file written AFTER that sync — see the banner for why that order is the
 * point. Returns the project with every per-service gap still open.
 */
async function fleetWithRootProject(files: Record<string, string> = fixture()): Promise<Project> {
  const p = await makeProject(files);
  expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
  expect(p.exists("services/payment-service/likec4.config.json")).toBe(false);
  await p.write("likec4.config.json", LIKEC4_PROJECT_CONFIG);
  return p;
}

describe("validate --all — service.likec4-config-missing", () => {
  it("one warning per model-bearing service, on the fleet target, at the service's tree path; the fleet stays valid", async () => {
    // Catches: the finding dropped, emitted per fleet instead of per service,
    // filed under a service target, graded as an error or gating, or spelled
    // at the root `services/<id>` for a filed service.
    const p = await fleetWithRootProject();
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      const payload = payloadOf(res.stdout);
      expect(payload.valid).toBe(true);
      const found = projectFindings(payload);
      expect(found.map((f) => f.target)).toEqual(["landscape", "landscape"]);
      expect(found.map((f) => f.finding)).toEqual([
        expect.objectContaining({
          severity: "warn",
          code: CODE,
          subject: "identity-service",
          locations: [{ path: "services/platform/identity-service", role: "scope" }],
        }),
        expect.objectContaining({
          severity: "warn",
          code: CODE,
          subject: "payment-service",
          locations: [{ path: "services/payment-service", role: "scope" }],
        }),
      ]);
      for (const { finding } of found) {
        expect(finding.message).toContain("loam subsystem sync");
        expect(finding.message).toContain(`${finding.locations?.[0]?.path}/likec4.config.json`);
      }
      // The summary counts them as the warnings they are: silence them and
      // exactly two leave the count, nothing else moves.
      await p.write("services/payment-service/likec4.config.json", renderServiceProject("payment-service", LIKEC4_ROOT_PROJECT));
      await p.write("services/platform/identity-service/likec4.config.json", renderServiceProject("identity-service", LIKEC4_ROOT_PROJECT));
      const quiet = payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(quiet.summary.warnings).toBe(payload.summary.warnings - 2);
      expect(quiet.summary.errors).toBe(payload.summary.errors);
    } finally {
      await p.destroy();
    }
  });

  it("a spec-only service is owed nothing: no model, no project, no finding", async () => {
    // Catches: the predicate grading on the directory rather than on the
    // model — a service `archive` materialised from a spec delta would then be
    // told to sync a project for a model that does not exist. The service's
    // own `service.no-model` error is the only error the run carries.
    const p = await fleetWithRootProject(withSpecOnlyService(fixture()));
    try {
      const payload = payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(payload.targets.flatMap((t) => t.findings.filter((f) => f.severity === "error").map((f) => f.code))).toEqual([
        "service.no-model",
      ]);
      expect(projectFindings(payload).map((f) => f.finding.subject)).toEqual(["identity-service", "payment-service"]);
    } finally {
      await p.destroy();
    }
  });

  it("--strict exits 1 while they stand — a warning, but a real one", async () => {
    // Catches: the finding emitted at a severity `--strict` does not count,
    // or `valid` flipping — the grade must stay green and only the exit move.
    const p = await fleetWithRootProject();
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--strict", "--json");
      expect(res.code).toBe(1);
      expect(payloadOf(res.stdout).valid).toBe(true);
      expect(projectFindings(payloadOf(res.stdout))).toHaveLength(2);
    } finally {
      await p.destroy();
    }
  });

  it("one `loam subsystem sync` clears every finding: the writer fills exactly the gap the grader names", async () => {
    // Catches: the writer and the grader disagreeing about which service is
    // owed a file — a second spelling of the predicate on either side, or a
    // writer that skips the filed service — and a writer emitting bytes the
    // renderer rule does not.
    const p = await fleetWithRootProject();
    try {
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      expect(await p.read("services/payment-service/likec4.config.json")).toBe(renderServiceProject("payment-service", LIKEC4_ROOT_PROJECT));
      expect(await p.read("services/platform/identity-service/likec4.config.json")).toBe(
        renderServiceProject("identity-service", LIKEC4_ROOT_PROJECT),
      );
      expect(p.exists("services/checkout-web/likec4.config.json")).toBe(false);
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      expect(projectFindings(payloadOf(res.stdout))).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("without the root likec4.config.json: silent, even though every model is there", async () => {
    // Catches: the root gate dropped. It does double duty — semantically, a
    // gap the writer would not fill (sync writes nothing without the root
    // file) must not be graded; and it is what keeps every `makeProject`
    // fixture in the suite silent, since the harness writes no root file. A
    // finding here would be one that `loam subsystem sync` cannot clear.
    const p = await makeProject(fixture());
    try {
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      expect(p.exists("likec4.config.json")).toBe(false);
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      expect(projectFindings(payloadOf(res.stdout))).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("a hand-written file with any bytes silences it: create-only means presence is the whole question", async () => {
    // Catches: the grader growing a byte or content compare — which would
    // restale a team's own `title`/styles keys and fight the file the rule
    // says is theirs — and a compare that reads the file at all (rule 26).
    const p = await fleetWithRootProject();
    try {
      await p.write("services/payment-service/likec4.config.json", "not even json\n");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      expect(projectFindings(payloadOf(res.stdout)).map((f) => f.finding.subject)).toEqual(["identity-service"]);
    } finally {
      await p.destroy();
    }
  });

  it("a directory whose name is not a legal service id is owed no file: sync skips it and the grade stays silent", async () => {
    // Catches: the writer minting `{"name": "pay@1"}` — a project the renderer
    // silently drops (measured at the pin: zero errors, absent from the list)
    // — and the grade then going quiet forever over a model that never
    // renders. `service.id-invalid` is the loud repair, and it must stand.
    const files = fixture();
    files["services/pay@1/model.likec4"] = SERVICE_MODEL;
    files["services/pay@1/spec.md"] = "---\nservice: pay@1\nstatus: draft\n---\n\n# pay@1\n";
    const p = await fleetWithRootProject(files);
    try {
      const before = payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(before.targets.flatMap((t) => t.findings.filter((f) => f.code === "service.id-invalid"))).toHaveLength(1);
      expect(projectFindings(before).map((f) => f.finding.subject)).toEqual(["identity-service", "payment-service"]);

      const sync = JSON.parse((await runLoam(p.workDir, "subsystem", "sync", "--json")).stdout) as {
        projects: { created: string[]; current: number };
      };
      // SORTED BY PATH, which is what SCHEMA and CHANGELOG say the key holds:
      // `services/payment-service/…` before `services/platform/…`, even though
      // the survey walked identity-service first (it sorts by service id).
      expect(sync.projects.created).toEqual([
        "services/payment-service/likec4.config.json",
        "services/platform/identity-service/likec4.config.json",
      ]);
      expect(sync.projects.created).toEqual([...sync.projects.created].sort());
      expect(sync.projects.current).toBe(0);
      expect(p.exists("services/pay@1/likec4.config.json")).toBe(false);

      const after = payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(projectFindings(after)).toEqual([]);
      expect(after.targets.flatMap((t) => t.findings.filter((f) => f.code === "service.id-invalid"))).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the grade still asked of every model rather than of the standalone
  // ones. A model that EXTENDS the map renders in the ROOT project, so a
  // per-service project file beside it claims the model out of the root project
  // — and telling its author to run `sync` would advertise a file that verb
  // refuses to write.
  it("an extending model is never told it is missing a project file — it is told the opposite", async () => {
    const files = fixture();
    files["services/payment-service/model.likec4"] = "model {\n  extend paymentService {\n  }\n}\n";
    const p = await fleetWithRootProject(files);
    try {
      const payload = payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      // The standalone one still is; the extending one is not.
      expect(projectFindings(payload).map((f) => f.finding.subject)).toEqual(["identity-service"]);
      // And with a project file beside it, it is `-stray` instead.
      await p.write("services/payment-service/likec4.config.json", '{"name":"payment-service"}\n');
      const stray = strayFindings(payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout));
      expect(stray).toHaveLength(1);
      expect(stray[0]).toEqual(
        expect.objectContaining({
          severity: "warn",
          code: "service.likec4-config-stray",
          subject: "payment-service",
          locations: [{ path: "services/payment-service", role: "scope" }],
        }),
      );
      // Catches the message going back to "holds nothing": measured at the
      // 1.59.2 pin the nested project CLAIMS the model, and the repair the
      // message names is now one `loam subsystem sync` performs.
      //
      // AND catches the container-loss clause going back to an unconditional
      // "measured" claim. Re-measured at the pin (re-verification 2026-09-04,
      // area C item 7): on `examples/docs` a stray beside the extending
      // order-service left `export json --project fleet` byte-identical — 33
      // elements, every `marketplace.orderService.*` child present — while
      // `likec4 validate .` went from ✓ Valid to ✗ Invalid ("Specify exact
      // project, known: [order-service, fleet]"); on a seeded six-service fleet
      // the same file DID drop `svc_svc_a.api` from that export, and deleting it
      // brought the container back. Both are true, so the sentence has to name
      // the certain harm first and the export loss as the case it is.
      expect(stray[0]?.message).toContain("a project of its own rooted at that directory");
      expect(stray[0]?.message).toContain("`likec4 validate .` then refuses without `--project`");
      expect(stray[0]?.message).toContain("wherever that nested project claims the model");
      expect(stray[0]?.message).toContain("Run `loam subsystem sync`; it deletes the file");
    } finally {
      await p.destroy();
    }
  });

  it("two services sharing a leaf name under different subsystems are each named at their own directory", async () => {
    // Catches: the grader joining a gap back to an entry BY ID — on a
    // colliding tree (still enumerated in full, and this grade is emitted
    // before the map's early returns on purpose) both findings then named the
    // first directory while `sync` wrote both files at the right paths.
    const files = fixture();
    for (const group of ["groupA", "groupB"]) {
      files[`services/${group}/subsystem.yaml`] = `title: ${group}\n`;
      files[`services/${group}/pay/model.likec4`] = SERVICE_MODEL;
      files[`services/${group}/pay/spec.md`] = "---\nservice: pay\nstatus: draft\n---\n\n# pay\n";
    }
    const p = await fleetWithRootProject(files);
    try {
      const payload = payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      const pays = projectFindings(payload).filter((f) => f.finding.subject === "pay");
      expect(pays.map((f) => f.finding.locations?.[0]?.path).sort()).toEqual(["services/groupA/pay", "services/groupB/pay"]);
      for (const { finding } of pays) {
        expect(finding.message).toContain(`${finding.locations?.[0]?.path}/likec4.config.json`);
      }
      const sync = JSON.parse((await runLoam(p.workDir, "subsystem", "sync", "--json")).stdout) as {
        projects: { created: string[] };
      };
      expect(sync.projects.created).toContain("services/groupA/pay/likec4.config.json");
      expect(sync.projects.created).toContain("services/groupB/pay/likec4.config.json");
    } finally {
      await p.destroy();
    }
  });
});

describe("validate --all — the root project's exclude, read the two ways", () => {
  /** The scaffold's list plus one entry, written verbatim so the tests read as the file does. */
  function rootWith(exclude: readonly string[]): string {
    return `${JSON.stringify({ name: "fleet", title: "Fleet landscape", exclude: [...exclude] }, null, 2)}\n`;
  }

  // Catches: a standalone model left inside the root project. Every kind it
  // declares is then a duplicate blamed on the map as well, so the whole root
  // project blanks — the loudest failure in this family, and until the root
  // config was read at all, nothing could see it.
  it("service.model-unexcluded names a standalone model the root does not exclude", async () => {
    const p = await fleetWithRootProject();
    try {
      const found = excludeFindings(payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout));
      expect(found.map((f) => f.code)).toEqual(["service.model-unexcluded", "service.model-unexcluded"]);
      expect(found.map((f) => f.subject).sort()).toEqual(["identity-service", "payment-service"]);
      expect(found[0]).toEqual(
        expect.objectContaining({
          severity: "warn",
          locations: [{ path: "services/platform/identity-service", role: "scope" }],
        }),
      );
      expect(found[0]?.message).toContain("adds services/platform/identity-service/** to the root project's `exclude`");
    } finally {
      await p.destroy();
    }
  });

  // Catches: an extending model hidden behind an inherited `services/**`. It
  // parses only in the root project, so the exclusion renders it as a box with
  // nothing inside — and the entry that hides it must be quoted, because on a
  // filed fleet it names a subsystem rather than the service.
  it("service.model-excluded quotes the entry that hides an extending model", async () => {
    const files = fixture();
    files["services/platform/identity-service/model.likec4"] = "model {\n  extend identityService {\n  }\n}\n";
    const p = await fleetWithRootProject(files);
    try {
      await p.write("likec4.config.json", rootWith(["**/node_modules/**", "services/platform/**", "features/**"]));
      const found = excludeFindings(payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout));
      const excluded = found.filter((f) => f.code === "service.model-excluded");
      expect(excluded).toHaveLength(1);
      expect(excluded[0]?.subject).toBe("identity-service");
      expect(excluded[0]?.message).toContain("excludes it ('services/platform/**')");
      // payment-service stands alone and is NOT covered by that entry, so it is
      // the other half of the pair.
      expect(found.filter((f) => f.code === "service.model-unexcluded").map((f) => f.subject)).toEqual(["payment-service"]);
    } finally {
      await p.destroy();
    }
  });

  // Catches the defect verbatim (re-verification 2026-09-04, area C item 5). A
  // FILE-shaped entry hides every model without covering any directory:
  // measured at the 1.59.2 pin on `examples/docs`, `services/**/model.likec4`
  // and the bare `**/model.likec4` each leave 3 source files of 8 and take all
  // five drill-down views out of `export json --project fleet`, while the whole
  // `validate --all` run reported 0 errors and did not contain the word
  // "exclude" once. The directory question cannot see it, so the FILE question
  // is asked too — and the message must NOT name `subsystem sync`, which
  // maintains only the `services/` directory entries and would report success
  // having changed nothing.
  it("service.model-excluded names a FILE-shaped entry, and says sync cannot repair it", async () => {
    const files = fixture();
    files["services/platform/identity-service/model.likec4"] = "model {\n  extend identityService {\n  }\n}\n";
    const p = await fleetWithRootProject(files);
    try {
      await p.write("likec4.config.json", rootWith(["**/node_modules/**", "services/**/model.likec4", "features/**"]));
      const found = excludeFindings(payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout));
      const excluded = found.filter((f) => f.code === "service.model-excluded");
      expect(excluded).toHaveLength(1);
      expect(excluded[0]?.subject).toBe("identity-service");
      expect(excluded[0]?.message).toContain("excludes it ('services/**/model.likec4')");
      expect(excluded[0]?.message).toContain("hides the model file without covering services/platform/identity-service/");
      expect(excluded[0]?.message).toContain("cannot repair it");
      expect(excluded[0]?.message).not.toContain("Run `loam subsystem sync`");
    } finally {
      await p.destroy();
    }
  });

  // The DIRECTORY question still wins where both could answer, because that arm
  // names an entry `subsystem sync` takes back and this one names an entry it
  // leaves alone. One state, one repair.
  it("prefers the directory entry when both questions can answer", async () => {
    const files = fixture();
    files["services/platform/identity-service/model.likec4"] = "model {\n  extend identityService {\n  }\n}\n";
    const p = await fleetWithRootProject(files);
    try {
      await p.write(
        "likec4.config.json",
        rootWith(["**/node_modules/**", "services/**/model.likec4", "services/platform/**", "features/**"]),
      );
      const excluded = excludeFindings(payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout)).filter(
        (f) => f.code === "service.model-excluded",
      );
      expect(excluded).toHaveLength(1);
      expect(excluded[0]?.message).toContain("excludes it ('services/platform/**')");
      expect(excluded[0]?.message).toContain("Run `loam subsystem sync`");
    } finally {
      await p.destroy();
    }
  });

  // Catches: a grade asserted over a file loam could not parse. loam does not
  // know what the renderer will do with it, and claiming an exclusion on
  // evidence it does not have is worse than saying nothing.
  it("silent when the root config is not readable as a project with an exclude list", async () => {
    const p = await fleetWithRootProject();
    try {
      await p.write("likec4.config.json", '{"name": "fleet", "exclude": "not a list"}\n');
      const payload = payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(excludeFindings(payload)).toEqual([]);
      expect(mapExcludedFindings(payload)).toEqual([]);
      // The sibling grade, which does not read that file, still holds.
      expect(projectFindings(payload)).toHaveLength(2);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the whole point of the code. The architecture loader keeps the map
  // whatever this list says, so loam's own grades are right — and that is
  // exactly what made the state invisible: `validate --all` came back with
  // nothing to say while the renderer opened on an empty fleet. The entry must
  // be quoted, because `architecture/*.likec4` is a line somebody wrote for a
  // palette and would never suspect.
  it("landscape.excluded names the entry that hides the fleet map, on the fleet target, without gating", async () => {
    const p = await fleetWithRootProject();
    try {
      await p.write("likec4.config.json", rootWith(["**/node_modules/**", "architecture/*.likec4", "features/**"]));
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      const payload = payloadOf(res.stdout);
      const found = mapExcludedFindings(payload);
      expect(found.map((f) => f.target)).toEqual(["landscape"]);
      expect(found[0]?.finding).toEqual(
        expect.objectContaining({
          severity: "warn",
          code: "landscape.excluded",
          locations: [{ path: "architecture/landscape.likec4", role: "primary" }],
        }),
      );
      expect(found[0]?.finding.message).toContain("covers architecture/landscape.likec4 ('architecture/*.likec4')");
      // The repair is the team's own edit, and saying otherwise is what the four
      // per-service grades may say and this one may not: sync recomputes the
      // `services/` entries only, so it would report success and change nothing.
      expect(found[0]?.finding.message).toContain("`loam subsystem sync` will not do it");
      // One finding per fleet, not one per service — the map is one document.
      expect(found).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  // Catches: a matcher loose enough to read the scaffold's own list as covering
  // the map. Every repo loam has ever created carries these two entries, so a
  // false positive here would fire on all of them.
  it("the scaffold's own entries — node_modules, services/** and features/** — leave the map alone", async () => {
    const p = await fleetWithRootProject();
    try {
      await p.write("likec4.config.json", rootWith(["**/node_modules/**", "services/**", "features/**"]));
      expect(mapExcludedFindings(payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout))).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the root gate slipping. With no root `likec4.config.json` there is
  // no root project, `doctor.likec4-config-missing` is the finding, and an
  // exclusion asserted over a file loam never opened is a claim about a renderer
  // nobody has wired yet.
  it("silent when there is no root likec4.config.json at all", async () => {
    const p = await makeProject(fixture());
    try {
      expect(p.exists("likec4.config.json")).toBe(false);
      expect(mapExcludedFindings(payloadOf((await runLoam(p.workDir, "validate", "--all", "--json")).stdout))).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});
