/**
 * `loam validate`'s human report, read the way a person reads it — top to
 * bottom, by its markers — rather than the way an agent reads `--json`.
 *
 * Every case here pins a way the text view used to mislead while the payload
 * was right:
 *
 *  - `service.no-model` printed with NO marker, so a run that exited 1 showed
 *    no ✗ anywhere (`service.unknown` likewise);
 *  - messages named files by the absolute path of the machine that ran the
 *    check — `No C4 model at C:\Users\…` — in the report and the payload alike;
 *  - `sources.unverifiable-from-here` printed ✓, a pass mark beside the
 *    sentence saying the check could not run here;
 *  - a code raised by every service printed once per service, so the one
 *    different warning sat somewhere inside N copies of the same one;
 *  - the fleet report printed in graded order, so the feature blocks and any
 *    error that made the run red came after every per-service line.
 *
 * Everything about those changes is rendering: each case also pins that the
 * `--json` codes, severities, counts and the exit code did not move.
 */
import { describe, expect, it } from "vitest";
import { COMMIT_INTENT } from "../src/core/staging/interrupted.js";
import { coherentFixture, LIVING_SPEC, makeProject, runLoam, type Project } from "./helpers/harness.js";

const SVC = "payment-service";

interface JsonFinding {
  severity: "ok" | "warn" | "error";
  code: string;
  subject?: string;
  message: string;
}
interface JsonTarget {
  kind: string;
  id: string;
  findings: JsonFinding[];
}
interface JsonReport {
  summary: { services: number; features: number; errors: number; warnings: number };
  targets: JsonTarget[];
}

async function withProject(
  files: Record<string, string>,
  opts: { service?: string },
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files, opts);
  // A realistic fleet has run `loam subsystem sync`: the two GENERATED views
  // files belong to a docs repo the way the landscape does, and their absence
  // is its own `subsystem.views-stale`. Every case here is about something else.
  await runLoam(p.workDir, "subsystem", "sync");
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

const lines = (out: string): string[] => out.split("\n");
const findingsOf = (json: JsonReport): JsonFinding[] => json.targets.flatMap((t) => t.findings);

/** Neither spelling of the fixture's absolute docs path, anywhere in `text`. */
function expectNoAbsolutePath(text: string, docsDir: string): void {
  expect(text).not.toContain(docsDir);
  expect(text).not.toContain(docsDir.replaceAll("\\", "/"));
}

/* ------------------------------------------------------------------ */
/* Fleet fixture: N one-element services, nothing called               */
/* ------------------------------------------------------------------ */

/** `svc-1` … `svc-N`, each modelled and drawn; `withSources` decides who declares `sources:`. */
function fleet(n: number, withSources: (i: number) => boolean): Record<string, string> {
  const files: Record<string, string> = {};
  const body: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    const id = `svc-${i}`;
    files[`services/${id}/model.likec4`] = `specification {
  element softwareSystem
}

model {
  svc${i} = softwareSystem '${id}' {
    metadata { service '${id}' }
  }
}

views {
  view of svc${i} {
    include *
  }
}
`;
    files[`services/${id}/spec.md`] = `---
service: ${id}
owner: team-${id}
status: draft${withSources(i) ? `\nsources:\n  - src/${id}.ts` : ""}
---

# ${id}

## Requirements

### Requirement: Do the thing
The service SHALL do the thing.

#### Scenario: It is done
- **Given** a thing
- **When** it runs
- **Then** it is done
`;
    body.push(`  svc${i} = softwareSystem '${id}' {
    metadata { service '${id}' }
  }`);
  }
  files["architecture/landscape.likec4"] = `specification {
  element softwareSystem
}

model {
${body.join("\n")}
}

views {
  view landscape {
    include *
  }
}
`;
  return files;
}

/* ------------------------------------------------------------------ */
/* 1. Every error carries its ✗                                        */
/* ------------------------------------------------------------------ */

describe("an error that stands alone is marked as one", () => {
  it("service.no-model prints ✗, and names the model by its repo-relative path", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/model.likec4`];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      const line = lines(res.out).find((l) => l.includes("No C4 model at"));
      expect(line).toBeDefined();
      expect(line!.startsWith(`✗ No C4 model at services/${SVC}/model.likec4. `)).toBe(true);
      expect(line).toContain("(service.no-model)");
      expectNoAbsolutePath(res.out, p.docsDir);

      // The payload: same code, same severity, the same relative words.
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout) as JsonReport;
      const noModel = findingsOf(json).filter((f) => f.code === "service.no-model");
      expect(noModel).toHaveLength(1);
      expect(noModel[0]!.severity).toBe("error");
      expect(noModel[0]!.message).toContain(`services/${SVC}/model.likec4`);
      expectNoAbsolutePath(noModel[0]!.message, p.docsDir);
    });
  });

  it("service.unknown prints ✗ too, with the directory it looked for", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "no-such-service");
      expect(res.code).toBe(1);
      const line = lines(res.out).find((l) => l.includes("No service directory at"));
      expect(line).toBeDefined();
      expect(line!.startsWith("✗ No service directory at services/no-such-service.")).toBe(true);
      expectNoAbsolutePath(res.out, p.docsDir);
    });
  });
});

/* ------------------------------------------------------------------ */
/* 2. Paths are the repository's, not the machine's                    */
/* ------------------------------------------------------------------ */

describe("a message names a file by its repo-relative path", () => {
  it("service.no-spec and service.no-openapi, in the report and in --json", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/spec.md`];
    delete files[`services/${SVC}/openapi.yaml`];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.out).toContain(`No living spec at services/${SVC}/spec.md — `);
      expect(res.out).toContain(`No OpenAPI contract at services/${SVC}/openapi.yaml`);
      expectNoAbsolutePath(res.out, p.docsDir);

      const json = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout) as JsonReport;
      const codes = findingsOf(json).map((f) => f.code);
      expect(codes).toContain("service.no-spec");
      expect(codes).toContain("service.no-openapi");
      for (const f of findingsOf(json)) expectNoAbsolutePath(f.message, p.docsDir);
    });
  });
});

/* ------------------------------------------------------------------ */
/* 3. A check that did not run is not a pass                           */
/* ------------------------------------------------------------------ */

describe("sources that only their own repo can check", () => {
  it("print the not-checked mark, never ✓ — and stay `ok` everywhere a machine reads", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = LIVING_SPEC.replace(
      "status: verified",
      "status: verified\nsources:\n  - src/payment.ts",
    );
    await withProject(files, {}, async (p) => {
      expect(await p.read(`services/${SVC}/spec.md`)).toContain("sources:");
      const res = await runLoam(p.workDir, "validate", "--service", SVC);
      const blind = lines(res.out).filter((l) => l.includes("source(s) declared, but this is not"));
      expect(blind).toHaveLength(1);
      expect(blind[0]!.startsWith(`○ ${SVC}: 1 source(s) declared`)).toBe(true);
      expect(res.out).not.toMatch(/^✓ .*source\(s\) declared/m);

      // Severity `ok` is frozen: not a warning, not counted, never trips --strict.
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--service", SVC, "--json")).stdout) as JsonReport;
      const finding = findingsOf(json).find((f) => f.code === "sources.unverifiable-from-here");
      expect(finding?.severity).toBe("ok");
      const strict = await runLoam(p.workDir, "validate", "--service", SVC, "--strict");
      expect(strict.code).toBe(json.summary.warnings + json.summary.errors > 0 ? 1 : 0);
      // And --errors-only drops it like any confirmation.
      const quiet = await runLoam(p.workDir, "validate", "--service", SVC, "--errors-only");
      expect(quiet.out).not.toContain("source(s) declared");
    });
  });
});

/* ------------------------------------------------------------------ */
/* 4. One counted line for a code every service raises                 */
/* ------------------------------------------------------------------ */

describe("--all groups a code more than three services raise", () => {
  it("prints the first finding as itself, then one counted, capped line naming the services", async () => {
    // Seven services, none declaring sources: seven `sources.absent` warnings.
    await withProject(fleet(7, () => false), {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout) as JsonReport;
      const absent = findingsOf(json).filter((f) => f.code === "sources.absent");
      expect(absent).toHaveLength(7);
      expect(absent.every((f) => f.severity === "warn")).toBe(true);

      const res = await runLoam(p.workDir, "validate", "--all");
      const out = lines(res.out);
      const coded = out.filter((l) => l.includes("(sources.absent)"));
      expect(coded).toHaveLength(1);
      expect(coded[0]!.startsWith("⚠ svc-1: spec.md names no sources")).toBe(true);
      const counted = out[out.indexOf(coded[0]!) + 1];
      expect(counted).toBe(
        "    same code ×7 on 7 services: svc-1, svc-2, svc-3, svc-4, svc-5 +2 more — every finding is in --json",
      );
      // The footer is the payload's count — grouping moved no number.
      const { errors, warnings } = json.summary;
      expect(res.out).toContain(`7 services, 0 features — ${errors} errors, ${warnings} warnings`);
      expect(warnings).toBeGreaterThanOrEqual(7);

      // --strict reads the unfiltered findings: the only warnings here are the
      // grouped ones, so this exit 1 is the pin that grouping never reaches it.
      expect((await runLoam(p.workDir, "validate", "--all", "--strict")).code).toBe(1);
      // --errors-only keeps the group and drops every confirmation.
      const quiet = await runLoam(p.workDir, "validate", "--all", "--errors-only");
      expect(quiet.out).toContain(counted);
      expect(quiet.out).not.toMatch(/^✓ /m);
      // The payload is untouched by either lever.
      const quietJson = await runLoam(p.workDir, "validate", "--all", "--errors-only", "--json");
      expect(JSON.parse(quietJson.stdout)).toEqual(json);
    });
  });

  it("leaves three services' copies alone — three lines are still read one by one", async () => {
    await withProject(fleet(5, (i) => i > 3), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      const coded = lines(res.out).filter((l) => l.includes("(sources.absent)"));
      expect(coded).toHaveLength(3);
      expect(res.out).not.toContain("same code ×");
    });
  });

  it("never groups a single-service run", async () => {
    await withProject(fleet(5, () => false), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "svc-2");
      expect(lines(res.out).filter((l) => l.includes("(sources.absent)"))).toHaveLength(1);
      expect(res.out).not.toContain("same code ×");
    });
  });
});

/* ------------------------------------------------------------------ */
/* 5. The fleet report reads top-down                                  */
/* ------------------------------------------------------------------ */

describe("--all puts the summary, the errors and the features before the services", () => {
  it("opens with the counts and an error index, prints features next, and every finding once", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/model.likec4`];
    await withProject(files, {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout) as JsonReport;
      const { errors, warnings } = json.summary;
      expect(errors).toBe(1);
      const counts = `1 service, 1 feature — 1 error, ${warnings} warning${warnings === 1 ? "" : "s"}`;

      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(1);
      const out = lines(res.out);
      // The head: the counts, then the index of errors by code.
      expect(out[0]).toBe(counts);
      expect(out[1]).toBe("errors by code:");
      expect(out[2]).toBe(`  ✗ service.no-model ×1: ${SVC}`);
      // The features before any service line.
      const feature = out.indexOf("FEAT-1");
      const firstService = out.findIndex((l) => l.includes(`${SVC}/model.likec4`) || l.startsWith(`✓ ${SVC}:`));
      expect(feature).toBeGreaterThan(2);
      expect(firstService).toBeGreaterThan(feature);
      // The full finding prints exactly once; the index only names it.
      expect(out.filter((l) => l.includes("No C4 model at"))).toHaveLength(1);
      // The footer still closes the report — CI logs are read from the tail.
      const footer = out.lastIndexOf(counts);
      expect(footer).toBeGreaterThan(firstService);
    });
  });

  it("prints no head over an empty listing: a clean fleet under --errors-only is just the footer", async () => {
    await withProject(fleet(2, () => true), {}, async (p) => {
      const quiet = await runLoam(p.workDir, "validate", "--all", "--errors-only");
      const counted = lines(quiet.out).filter((l) => /^\d+ services?, \d+ features? — /.test(l));
      expect(counted).toHaveLength(1);
    });
  });

  it("leads with an interrupted commit, before the counts, and prints it once", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      // The bytes a crash DURING the journal write leaves.
      await p.write(COMMIT_INTENT, '{"version":2,"command":"reba');
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(1);
      const out = lines(res.out);
      expect(out[0]!.startsWith(`✗ ${COMMIT_INTENT} records`)).toBe(true);
      expect(out.filter((l) => l.startsWith(`✗ ${COMMIT_INTENT} records`))).toHaveLength(1);
      expect(out[1]).toMatch(/^1 service, 1 feature — 1 error, /);
      expect(out).toContain("  ✗ docs.commit-interrupted ×1: landscape");
    });
  });
});
