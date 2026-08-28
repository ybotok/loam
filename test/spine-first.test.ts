/**
 * Pins the spine-first entry — README's "Start from the fleet spine" and
 * WORKFLOW.md's day zero step 2 — against the real commands, from the real
 * `examples/fleet.yaml`.
 *
 * The claim this file exists to keep true is narrow and load-bearing: a fleet
 * that has authored NO requirement Markdown, run NO `loam adopt` and vouched
 * nothing already gets a mechanical cross-service conviction out of loam. That
 * is the only path in the product that pays off inside an hour, and it is the
 * one a reader is told to follow first. If `service.no-spec` ever became an
 * error, or `spine.op-undefined` stopped reading the landscape when the service
 * models are absent, the documented first hour would end in a wall of failures
 * about documents the reader was never asked to write yet — and nothing else in
 * the suite would notice, because every other fixture is already adopted.
 *
 * The `service.no-model` errors are asserted too, and exactly. They are NOT a
 * blemish to be tuned away: five seeded directories with no C4 centre is a
 * truthful reading of a fleet where adoption has not started, and the README
 * block tells the reader to expect them by name. Asserting the count is what
 * stops that promise drifting from the binary.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

const FLEET_FILE = fileURLToPath(new URL("../examples/fleet.yaml", import.meta.url));

/**
 * payment-service's contract, cut to the one operation the edge below names.
 * Deliberately spelled the American way, because the landscape edge is spelled
 * the British way: the whole demonstration is that one letter is caught by a
 * token comparison and by nothing else a team would otherwise run.
 */
const PAYMENT_OPENAPI = `openapi: 3.1.0
info:
  title: payment-service
  version: 1.0.0
paths:
  /payments:
    post:
      operationId: authorizePayment
      summary: Authorize a payment
      responses:
        "201":
          description: Authorized
          content:
            application/json:
              schema:
                type: object
`;

interface Finding {
  severity: string;
  code: string;
  message: string;
}

function findingsOf(stdout: string): Finding[] {
  const parsed = JSON.parse(stdout) as {
    targets?: { findings?: Finding[] }[];
  };
  return (parsed.targets ?? []).flatMap((t) => t.findings ?? []);
}

let project: Project;

beforeAll(async () => {
  // `seed` refuses a docs directory with no services/ — the tree it enumerates
  // under the lock IS the fleet, so the scaffold's own marker has to be there.
  project = await makeProject({ "services/.gitkeep": "" });
});

afterAll(async () => {
  await project.destroy();
});

describe("the spine-first entry", () => {
  it("seeds the fleet map and one directory per service from the shipped example", async () => {
    const fleet = await readFile(FLEET_FILE, "utf8");
    // `--from` resolves against the cwd the command runs in, which is the
    // service-side working directory holding loam.json — the same place a
    // reader following the README would keep it.
    await writeFile(join(project.workDir, "fleet.yaml"), fleet, "utf8");

    const seeded = await runLoam(project.workDir, "seed", "--from", "fleet.yaml");
    expect(seeded.code).toBe(0);

    expect(project.exists("architecture/landscape.likec4")).toBe(true);
    for (const dir of [
      "services/checkout-web",
      "services/order-service",
      "services/payment-service",
      "services/platform/identity-service",
      "services/platform/notification-service",
    ]) {
      expect(project.exists(dir)).toBe(true);
    }
    // The subsystem in fleet.yaml became the grouping directory, not a service.
    expect(project.exists("services/platform/subsystem.yaml")).toBe(true);
  });

  it("convicts a misspelled operationId with no requirement Markdown anywhere", async () => {
    await project.write("services/payment-service/openapi.yaml", PAYMENT_OPENAPI);

    // Give the one edge an operation, spelled wrong. Seed writes this edge
    // bare; naming the operation is exactly the labour the documented first
    // hour asks for, and this is what it buys.
    const landscapePath = "architecture/landscape.likec4";
    const landscape = await project.read(landscapePath);
    const bare = "  svc_order_service -> svc_payment_service\n";
    expect(landscape).toContain(bare);
    await project.write(
      landscapePath,
      landscape.replace(
        bare,
        "  svc_order_service -> svc_payment_service 'Authorises' {\n" +
          "    metadata { op 'authorisePayment' }\n" +
          "  }\n",
      ),
    );

    const validated = await runLoam(project.workDir, "validate", "--all", "--json");
    const findings = findingsOf(validated.stdout);
    const codes = findings.filter((f) => f.severity !== "ok").map((f) => f.code);

    // The finding the reader came for: a fleet-crossing call naming an
    // operation its provider does not define.
    const spine = findings.find((f) => f.code === "spine.op-undefined");
    expect(spine).toBeDefined();
    expect(spine!.severity).toBe("error");
    expect(spine!.message).toContain("authorisePayment");
    expect(validated.code).toBe(1);

    // Adoption has not started, and the report says so without pretending the
    // absent documents are a fleet's worth of coverage.
    expect(codes.filter((c) => c === "service.no-model")).toHaveLength(5);
    expect(codes.filter((c) => c === "service.no-spec")).toHaveLength(5);

    // What must NOT be here: nothing asks for a delta, a vouch, a capability or
    // a permission on this path. A fleet at the bottom rung owes none of them.
    expect(codes).not.toContain("landscape.missing");
    expect(codes.some((c) => c.startsWith("delta."))).toBe(false);
    expect(codes.some((c) => c.startsWith("capability."))).toBe(false);
  });
});
