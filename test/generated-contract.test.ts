/**
 * `contracts.openapi` — the build's own contract, compared with the copy the
 * docs repo committed.
 *
 * SCHEMA's most load-bearing untested premise is that `services/<id>/openapi.yaml`
 * is the contract the service actually serves. Most fleets generate that
 * document (springdoc, FastAPI, NestJS) and copy it across by hand, so the
 * premise decays silently: the spine checks go on grading last quarter's
 * endpoints and nothing in the product can say so.
 *
 * Two assertions carry the check's whole value, and they pull in opposite
 * directions:
 *
 * 1. A REAL divergence is reported (`openapi.generated-stale`).
 * 2. A cosmetic one is NOT. Two generator versions ordering keys differently,
 *    or a YAML dumper re-wrapping a line, must produce silence — otherwise the
 *    warning is permanent, unclearable, and the first thing a fleet turns off.
 *    That is why the digest is over canonical JSON rather than raw bytes, and
 *    the reordering case below is what pins it.
 *
 * The check never writes. The copy stays a human `cp` reviewed in a pull
 * request, because that is what makes the committed contract a document
 * somebody agreed to rather than a cache of whatever the build last produced.
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  coherentFixture,
  makeProject,
  runLoam,
  type Project,
} from "./helpers/harness.js";

const SERVICE = "payment-service";

let project: Project | null = null;
afterEach(async () => {
  await project?.destroy();
  project = null;
});

/** The fixture, plus a build output the service repo's loam.json points at. */
async function withBuild(
  contracts: Record<string, string> | undefined,
  write: (committed: string) => Promise<string> | string,
): Promise<{ codes: string[]; out: string }> {
  project = await makeProject(coherentFixture(), { service: SERVICE });
  const committed = await project.read(`services/${SERVICE}/openapi.yaml`);
  await mkdir(join(project.workDir, "build"), { recursive: true });
  await writeFile(join(project.workDir, "build", "openapi.yaml"), await write(committed), "utf8");
  await writeFile(
    join(project.workDir, "loam.json"),
    JSON.stringify(
      { docsDir: project.docsDir, service: SERVICE, ...(contracts === undefined ? {} : { contracts }) },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  const run = await runLoam(project.workDir, "validate", "--service", SERVICE, "--json");
  const parsed = JSON.parse(run.stdout) as { targets?: { findings?: { code: string }[] }[] };
  return {
    codes: (parsed.targets ?? [])
      .flatMap((t) => t.findings ?? [])
      .map((f) => f.code)
      .filter((c) => c.startsWith("contracts.") || c === "openapi.generated-stale"),
    out: run.out,
  };
}

describe("the generated contract check", () => {
  it("says nothing at all when loam.json declares no contracts block", async () => {
    // The whole family is opt-in. A fleet that never writes the key pays
    // nothing, and no existing repo starts reporting anything.
    const { codes } = await withBuild(undefined, (committed) => committed);
    expect(codes).toEqual([]);
  });

  it("stays silent when the build and the committed copy agree", async () => {
    const { codes } = await withBuild({ openapi: "build/openapi.yaml" }, (c) => c);
    expect(codes).toEqual([]);
  });

  it("stays silent when only key order and formatting differ", async () => {
    // THE false-positive guard. If this fails, the digest has stopped being
    // canonical and the warning has become permanent noise.
    const { codes } = await withBuild({ openapi: "build/openapi.yaml" }, (committed) =>
      stringifyYaml(parseYaml(committed), { sortMapEntries: true, lineWidth: 40 }),
    );
    expect(codes).toEqual([]);
  });

  it("reports openapi.generated-stale when the build serves something else", async () => {
    const { codes, out } = await withBuild({ openapi: "build/openapi.yaml" }, (committed) => {
      const doc = parseYaml(committed) as { paths: Record<string, unknown> };
      doc.paths["/payments/{id}/void"] = {
        post: { operationId: "voidPayment", responses: { "200": { description: "ok" } } },
      };
      return stringifyYaml(doc);
    });
    expect(codes).toEqual(["openapi.generated-stale"]);
    // A warning, never an error: the divergence is a fact to review, and the
    // human decides which side is right. loam never copies the file across.
    expect(out).not.toContain("copied");
  });

  it("reports contracts.source-missing when the build has not run", async () => {
    project = await makeProject(coherentFixture(), { service: SERVICE });
    await writeFile(
      join(project.workDir, "loam.json"),
      JSON.stringify(
        { docsDir: project.docsDir, service: SERVICE, contracts: { openapi: "build/openapi.yaml" } },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const run = await runLoam(project.workDir, "validate", "--service", SERVICE, "--json");
    const parsed = JSON.parse(run.stdout) as { targets?: { findings?: { code: string; severity: string }[] }[] };
    const found = (parsed.targets ?? []).flatMap((t) => t.findings ?? []).filter((f) => f.code === "contracts.source-missing");
    expect(found).toHaveLength(1);
    // An error: CI that validates before it builds gets a wrong answer
    // otherwise, and a silently skipped check is the failure this whole product
    // is written against.
    expect(found[0]!.severity).toBe("error");
  });

  it("refuses a path that escapes the repository, as a finding and not a crash", async () => {
    const { codes, out } = await withBuild({ openapi: "../../../etc/passwd" }, (c) => c);
    expect(codes).toEqual(["contracts.source-invalid"]);
    // Containment is graded here rather than at config load: a throwing config
    // would take down every command in the repo, including the ones with
    // nothing to do with contracts.
    expect(out).not.toContain("ConfigError");
  });

  it("keeps the committed contract as the source of truth — nothing is written", async () => {
    project = await makeProject(coherentFixture(), { service: SERVICE });
    const before = await project.read(`services/${SERVICE}/openapi.yaml`);
    await mkdir(join(project.workDir, "build"), { recursive: true });
    const doc = parseYaml(before) as { paths: Record<string, unknown> };
    doc.paths["/payments/{id}/void"] = { post: { operationId: "voidPayment", responses: { "200": { description: "ok" } } } };
    await writeFile(join(project.workDir, "build", "openapi.yaml"), stringifyYaml(doc), "utf8");
    await writeFile(
      join(project.workDir, "loam.json"),
      JSON.stringify({ docsDir: project.docsDir, service: SERVICE, contracts: { openapi: "build/openapi.yaml" } }, null, 2) + "\n",
      "utf8",
    );
    await runLoam(project.workDir, "validate", "--service", SERVICE, "--json");
    expect(await project.read(`services/${SERVICE}/openapi.yaml`)).toBe(before);
    // And the build output is not touched either — this is a reader.
    expect(await readFile(join(project.workDir, "build", "openapi.yaml"), "utf8")).toBe(stringifyYaml(doc));
  });
});
