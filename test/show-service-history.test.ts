/**
 * `loam show <service>` says what the service IS, in the map's own words, and
 * which archived features wrote its documents.
 *
 * A living spec created by an archive reads as if it had always been there:
 * the delta's title and purpose stay with the archived feature, and nothing on
 * the service's own page pointed back at it. The map's `description` is the
 * one sentence about the service loam can show without inventing it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function archivedFleet(): Promise<Project> {
  const p = await makeProject(coherentFixture());
  cleanups.push(() => p.destroy());
  const archived = await runLoam(p.workDir, "archive", "FEAT-1");
  expect(archived.code, archived.out).toBe(0);
  return p;
}

describe("show <service> — description and history", () => {
  it("a service a feature created: the map's description, and the feature that shaped it", async () => {
    const p = await archivedFleet();

    const json = JSON.parse((await runLoam(p.workDir, "show", "payment-split-service", "--json")).stdout);
    expect(json.landscape.description).toBe("Splits a payment across payees");
    expect(json.shapedBy).toEqual(["FEAT-1"]);

    const text = await runLoam(p.workDir, "show", "payment-split-service");
    expect(text.out).toContain("Splits a payment across payees");
    expect(text.out).toContain("shaped by  FEAT-1 (archived)");
  });

  it("a service no archived feature touched: its description, and no history line", async () => {
    const p = await archivedFleet();

    const json = JSON.parse((await runLoam(p.workDir, "show", "payment-service", "--json")).stdout);
    expect(json.landscape.description).toBe("Owns payment authorization/capture");
    expect(json.shapedBy).toEqual([]);
    expect((await runLoam(p.workDir, "show", "payment-service")).out).not.toContain("shaped by");
  });
});
