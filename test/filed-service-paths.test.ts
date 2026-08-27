/**
 * Every message that names an EXISTING service's directory must spell it from
 * the enumeration, never by joining `services/<id>/` at the root.
 *
 * One suite for the whole class rather than a case scattered into each
 * command's own file, because the class is what recurs: the join is right for
 * an unfiled fleet and wrong for every filed one, and it was written eight
 * separate times before anybody noticed. `core/repo/entries.ts` had the rule in
 * prose since the id check was added — "a finding naming a root directory that
 * does not exist sends the fix to the wrong place" — and prose is exactly what
 * did not stop the next seven.
 *
 * The inverse is asserted too, and it is not padding. A message about a service
 * that does NOT exist has no directory to name, and `services/<id>/` is then
 * the correct spelling — it is the path the fix would create. A sweep that
 * "fixed" those would be a regression this suite has to refuse.
 */
import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coherentFixture, makeProject, runLoam, LIVING_SPEC } from "./helpers/harness.js";

/** `coherentFixture()` with payment-service filed under a `platform` subsystem. */
function filedFixture(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(coherentFixture())) {
    files[path.replace(/^services\/payment-service\//, "services/platform/payment-service/")] = content;
  }
  files["services/platform/subsystem.yaml"] = "title: Platform\n";
  return files;
}

const FILED = "services/platform/payment-service";
const ROOT = "services/payment-service/";

describe("a filed service is named at the path it occupies", () => {
  it("`loam status` — the adoption rungs, both of them", async () => {
    const files = filedFixture();
    // Two services at two rungs: one with nothing written down (`next.adopt`),
    // one with a spec and no model (`next.complete-service`).
    files["services/platform/orphan-service/.gitkeep"] = "";
    files["services/platform/half-service/spec.md"] = LIVING_SPEC.replace(/payment-service/g, "half-service");
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "status", "--json");
      const payload = JSON.parse(res.stdout) as { next: Array<{ code: string; statement: string }> };
      const said = payload.next.map((n) => n.statement).join("\n");
      expect(said).toContain("services/platform/orphan-service/");
      expect(said).toContain("services/platform/half-service/");
      expect(said).not.toContain("services/orphan-service/");
      expect(said).not.toContain("services/half-service/");
    } finally {
      await p.destroy();
    }
  });

  it("`loam validate --all` — the unmodelled-service error", async () => {
    const files = filedFixture();
    // A service directory the landscape draws nothing for.
    files["services/platform/ghost-service/spec.md"] = LIVING_SPEC.replace(/payment-service/g, "ghost-service");
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const payload = JSON.parse(res.stdout) as { targets: Array<{ findings: Array<{ code: string; message: string }> }> };
      const unmodelled = payload.targets
        .flatMap((t) => t.findings)
        .filter((f) => f.code === "landscape.service-unmodelled");
      expect(unmodelled.length).toBeGreaterThan(0);
      const said = unmodelled.map((f) => f.message).join("\n");
      expect(said).toContain("services/platform/ghost-service/");
      expect(said).not.toContain("services/ghost-service/");
    } finally {
      await p.destroy();
    }
  });

  it("`loam gate` — the target's own adoption rung", async () => {
    const files = filedFixture();
    // Below `documented`: the rung check names the directory to go and fill.
    delete files[`${FILED}/spec.md`];
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "gate", "--service", "payment-service", "--json");
      expect(res.stdout).toContain(FILED);
      expect(res.stdout).not.toContain(ROOT);
    } finally {
      await p.destroy();
    }
  });

  it("`loam adopt` — the brief handed to an agent that will go and edit files", async () => {
    const files = filedFixture();
    // Unmodelled in the landscape, so the brief carries its landscape
    // instruction — the sentence that used to send an agent to create a second
    // directory beside the one that already exists.
    files["architecture/landscape.likec4"] = files["architecture/landscape.likec4"]!.replace(
      /paymentService = softwareSystem 'payment-service'/,
      "paymentService = softwareSystem 'something-else'",
    );
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "adopt", "--service", "payment-service", "--json");
      expect(res.stdout).toContain(FILED);
      expect(res.stdout).not.toContain(ROOT);
    } finally {
      await p.destroy();
    }
  });

  it("`loam seed` — the line that is ABOUT where an existing service stays", async () => {
    const files = filedFixture();
    // The fixture's landscape is hand-authored, and seed refuses to overwrite
    // human work (`seed-landscape-edited`). Removing it puts seed on its
    // write path, which is the path that prints these lines.
    delete files["architecture/landscape.likec4"];
    const p = await makeProject(files);
    try {
      // The fleet file is read from the CWD, never from the docs repo.
      await writeFile(join(p.workDir, "fleet.yaml"), "services:\n  - id: payment-service\n  - id: checkout-web\n", "utf8");
      const res = await runLoam(p.workDir, "seed");
      expect(res.code).toBe(0);
      expect(res.stdout).toContain(`= ${FILED}/ already exists`);
      expect(res.stdout).not.toContain(`= ${ROOT} already exists`);
    } finally {
      await p.destroy();
    }
  });
});

describe("a service that does NOT exist keeps the unfiled spelling", () => {
  it("`loam adopt` on a name nothing answers to names the path the fix would create", async () => {
    const p = await makeProject(filedFixture());
    try {
      const res = await runLoam(p.workDir, "adopt", "--service", "payment-servce", "--json");
      expect(res.code).toBe(0);
      // There is no directory to point at, so `services/<id>/` is the honest
      // answer — it is where the service would go, not where it is. A sweep
      // that rewrote this one would be the regression, not the fix.
      expect(res.stdout + res.stderr).toContain("services/payment-servce/");
    } finally {
      await p.destroy();
    }
  });
});
