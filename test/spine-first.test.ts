/**
 * Pins the spine-first entry — QUICKSTART's step 2 and WORKFLOW.md's day
 * zero step 2 — against the real
 * commands, from the real `examples/fleet.yaml` and the example fleet's own
 * contracts.
 *
 * The claim this file exists to keep true is narrow and load-bearing: a fleet
 * that has authored NO requirement Markdown, run NO `loam adopt`, vouched
 * nothing and hand-edited no LikeC4 already gets a mechanical cross-service
 * verdict out of loam — green when its joins are right, and a conviction naming
 * the join when one letter is wrong. That is the only path in the product that
 * pays off inside an hour, and it is the one a reader is told to follow first.
 * If `seed` stopped drawing a stated operation, if `--spine` started hiding a
 * spine code or grading an adoption one, or if `service.no-spec` ever became an
 * error, the documented first hour would end in a wall of failures about
 * documents the reader was never asked to write yet — and nothing else in the
 * suite would notice, because every other fixture is already adopted or writes
 * its map by hand.
 *
 * It is also the acceptance criterion ROADMAP.md recorded for spine-lite's
 * first increment before any of it was written ("spine-lite — the fleet spine
 * without adoption"): seed from the shipped example, `validate --all --spine`
 * exits 0 with `--strict` too and names the joins it checked, one letter wrong
 * is `spine.op-undefined` and exit 1, a branch removing a consumed operation
 * fails `loam diff --base` naming the consumer, and a join-free fleet.yaml draws
 * the edges 0.2.0-alpha.18 drew. The last is pinned edge for edge here on the
 * example that release shipped, and model block for model block, on a fleet
 * shaped to exercise every ordering rule, by test/seed-joins.test.ts's I2 case.
 *
 * The `service.no-model` errors of the default run are asserted too, and
 * exactly. They are NOT a blemish to be tuned away: five seeded directories with
 * no C4 centre is a truthful reading of a fleet where adoption has not started,
 * and QUICKSTART's step 2 tells the reader to expect them by name when they drop
 * `--spine`. Asserting the count is what stops that promise drifting from the
 * binary.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

const FLEET_FILE = fileURLToPath(new URL("../examples/fleet.yaml", import.meta.url));
const EXAMPLE_SERVICES = fileURLToPath(new URL("../examples/docs/services/", import.meta.url));

/**
 * The six contracts the example fleet's joins are checked against, as the
 * README tells a reader to drop them in: each service's own file, copied into
 * the directory seed made for it. Docs-relative, under services/.
 */
const CONTRACTS = [
  "order-service/openapi.yaml",
  "order-service/asyncapi.yaml",
  "payment-service/openapi.yaml",
  "payment-service/asyncapi.yaml",
  "platform/identity-service/openapi.yaml",
  "platform/notification-service/asyncapi.yaml",
];

interface Finding {
  severity: string;
  code: string;
  message: string;
  details?: string[];
}

interface ValidatePayload {
  valid?: boolean;
  targets?: { id: string; findings?: Finding[] }[];
  scorecard?: unknown;
  lens?: {
    joins?: { operations: number; messages: number; drawnOnly: string[]; toExternals: number };
    hidden: { errors: number; warnings: number; byCode: Record<string, number> };
  };
}

function findingsOf(payload: ValidatePayload): Finding[] {
  return (payload.targets ?? []).flatMap((t) => t.findings ?? []);
}

async function validateJson(p: Project, ...args: string[]): Promise<{ code: number; payload: ValidatePayload }> {
  const run = await runLoam(p.workDir, "validate", ...args, "--json");
  return { code: run.code, payload: JSON.parse(run.stdout) as ValidatePayload };
}

/**
 * Seed `fleet` exactly as the README has a reader do it, from the working
 * directory holding loam.json — `--from` resolves against the cwd, the
 * service-side place a reader following the README keeps fleet.yaml.
 */
async function seed(p: Project, fleet: string, ...flags: string[]): Promise<{ code: number; stdout: string }> {
  await writeFile(join(p.workDir, "fleet.yaml"), fleet, "utf8");
  return runLoam(p.workDir, "seed", "--from", "fleet.yaml", ...flags);
}

/**
 * The README's whole first hour in one call: an empty docs repo, the shipped
 * fleet.yaml seeded into it, and each service's own contracts copied in. The
 * contracts are normalised to LF so the fixture is the same bytes on a CRLF
 * checkout — the diff case below cuts one of them by line.
 */
async function seededExample(): Promise<Project> {
  // `seed` refuses a docs directory with no services/ — the tree it enumerates
  // under the lock IS the fleet, so the scaffold's own marker has to be there.
  const p = await makeProject({ "services/.gitkeep": "" });
  const seeded = await seed(p, await readFile(FLEET_FILE, "utf8"));
  if (seeded.code !== 0) throw new Error(`seed failed: ${seeded.stdout}`);
  for (const contract of CONTRACTS) {
    const text = await readFile(join(EXAMPLE_SERVICES, contract), "utf8");
    await p.write(`services/${contract}`, text.replace(/\r\n/g, "\n"));
  }
  return p;
}

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

describe("the spine-first entry, from the shipped examples/fleet.yaml", () => {
  it("seeds the fleet map and one directory per service, with every stated join drawn", async () => {
    const p = await makeProject({ "services/.gitkeep": "" });
    try {
      const seeded = await seed(p, await readFile(FLEET_FILE, "utf8"), "--json");
      expect(seeded.code, seeded.stdout).toBe(0);
      const payload = JSON.parse(seeded.stdout) as {
        calls: number;
        joins: { operations: number; publishes: number; consumes: number };
        next: string[];
      };
      // Seven call pairs under `calls:` — five of them naming operations — and
      // the messages stated under `publishes:` and `consumes:`, one edge each.
      expect(payload.calls).toBe(7);
      expect(payload.joins).toEqual({ operations: 7, publishes: 3, consumes: 3 });
      // A stated join is a claim about two contracts, so the run that grades
      // exactly those claims is what seed tells the reader to do next.
      expect(payload.next[0]).toBe("loam validate --all --spine");

      expect(p.exists("architecture/landscape.likec4")).toBe(true);
      for (const dir of [
        "services/checkout-web",
        "services/order-service",
        "services/payment-service",
        "services/platform/identity-service",
        "services/platform/notification-service",
      ]) {
        expect(p.exists(dir)).toBe(true);
      }
      // The subsystem in fleet.yaml became the grouping directory, not a service.
      expect(p.exists("services/platform/subsystem.yaml")).toBe(true);
      // The operation is on the map because fleet.yaml stated it, not because a
      // human opened the LikeC4 — the labour the old first hour asked for.
      const map = await p.read("architecture/landscape.likec4");
      expect(map).toContain(
        "  svc_order_service -[calls]-> svc_payment_service 'refundPayment' {\n    metadata { op 'refundPayment' }\n  }\n",
      );
      expect(map).toContain(
        "  ext_kafka -[delivers]-> svc_order_service 'payment.PaymentAuthorized' {\n" +
          "    metadata { consumes 'payment.PaymentAuthorized' }\n  }\n",
      );
    } finally {
      await p.destroy();
    }
  });

  it("the first `validate --all --spine` is green when the joins are right — `--strict` too — and names the joins it checked", async () => {
    const p = await seededExample();
    try {
      const { code, payload } = await validateJson(p, "--all", "--spine");
      const raised = findingsOf(payload).filter((f) => f.severity !== "ok");
      expect(raised, JSON.stringify(raised, null, 2)).toEqual([]);
      expect(code).toBe(0);
      expect(payload.valid).toBe(true);
      // The green is a grade, not a skip: each provider's inbound calls resolved.
      expect(findingsOf(payload).filter((f) => f.code === "spine.resolved")).toHaveLength(3);
      expect(payload.lens?.joins).toEqual({
        operations: 7,
        messages: 6,
        drawnOnly: ["customer → checkout-web"],
        toExternals: 1,
      });
      // What it set aside, it counts: the adoption ladder is hidden, not gone.
      expect(payload.lens?.hidden.byCode["service.no-model"]).toBe(5);
      expect(payload.lens?.hidden.byCode["service.no-spec"]).toBe(5);

      // The example names `introspectToken`, not the deprecated
      // `validateToken`, so the CI recipe's stricter grade is green as well.
      expect((await runLoam(p.workDir, "validate", "--all", "--spine", "--strict")).code).toBe(0);

      // And a person reading the text sees how much was checked, in words.
      const text = await runLoam(p.workDir, "validate", "--all", "--spine");
      expect(text.code).toBe(0);
      expect(text.stdout).toContain("joins: 7 calls name an operation · 6 message joins");
      expect(text.stdout).toContain("not graded under --spine: 5 errors, 11 warnings");
    } finally {
      await p.destroy();
    }
  });

  it("without `--spine` the same fleet reports the adoption ladder, exactly as before", async () => {
    const p = await seededExample();
    try {
      const { code, payload } = await validateJson(p, "--all");
      const codes = findingsOf(payload)
        .filter((f) => f.severity !== "ok")
        .map((f) => f.code);
      expect(code).toBe(1);
      expect(payload).not.toHaveProperty("lens");
      expect(payload).toHaveProperty("scorecard");

      // Adoption has not started, and the report says so without pretending the
      // absent documents are a fleet's worth of coverage.
      expect(codes.filter((c) => c === "service.no-model")).toHaveLength(5);
      expect(codes.filter((c) => c === "service.no-spec")).toHaveLength(5);

      // What must NOT be here: nothing asks for a delta, a vouch, a capability or
      // a permission on this path, and no join is wrong. A fleet at the bottom
      // rung owes none of them.
      expect(codes).not.toContain("landscape.missing");
      expect(codes.some((c) => c.startsWith("spine."))).toBe(false);
      expect(codes.some((c) => c.startsWith("delta."))).toBe(false);
      expect(codes.some((c) => c.startsWith("capability."))).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("one letter wrong in fleet.yaml, re-seeded, is `spine.op-undefined` with a did-you-mean, and exit 1", async () => {
    const p = await seededExample();
    try {
      // The fix and the mistake both live in fleet.yaml now: the map is still
      // seed's, so re-running regenerates it rather than refusing.
      const fleet = await readFile(FLEET_FILE, "utf8");
      const right = "checkout-web -> payment-service: authorizePayment";
      expect(fleet).toContain(right);
      const reseeded = await seed(p, fleet.replace(right, "checkout-web -> payment-service: authorisePayment"), "--json");
      expect(reseeded.code, reseeded.stdout).toBe(0);
      expect((JSON.parse(reseeded.stdout) as { landscape: string }).landscape).toBe("regenerated");

      const { code, payload } = await validateJson(p, "--all", "--spine");
      const raised = findingsOf(payload).filter((f) => f.severity !== "ok");
      // The finding the reader came for — a fleet-crossing call naming an
      // operation its provider does not define — and nothing else.
      expect(raised.map((f) => f.code)).toEqual(["spine.op-undefined"]);
      expect(raised[0]!.severity).toBe("error");
      expect(raised[0]!.message).toContain("authorisePayment");
      expect(raised[0]!.message).toContain("did you mean 'authorizePayment'?");
      expect(code).toBe(1);

      // The default run convicts the same join; the lens narrowed, it did not
      // re-grade.
      const plain = await validateJson(p, "--all");
      expect(findingsOf(plain.payload).filter((f) => f.code === "spine.op-undefined")).toHaveLength(1);
      expect(plain.code).toBe(1);
    } finally {
      await p.destroy();
    }
  });

  it("a branch that drops an operation the map still calls fails `loam diff --base`, naming the consumer", async () => {
    const p = await seededExample();
    try {
      git(p.docsDir, "init", "-q", "-b", "main");
      git(p.docsDir, "add", "-A");
      git(p.docsDir, "-c", "user.email=spine@test.invalid", "-c", "user.name=Spine Test", "commit", "-q", "-m", "base");

      // payment-service's branch takes refundPayment out of its contract, path
      // item and all; order-service still calls it, because fleet.yaml says so.
      const contract = "services/payment-service/openapi.yaml";
      const before = await p.read(contract);
      const start = before.indexOf("  /payments/{id}/refund:\n");
      const end = before.indexOf("\ncomponents:\n");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      await p.write(contract, before.slice(0, start) + before.slice(end + 1));

      const diffed = await runLoam(p.workDir, "diff", "--base", "main", "--json");
      expect(diffed.code).toBe(1);
      const payment = (
        JSON.parse(diffed.stdout) as { services: { id: string; findings: Finding[] }[] }
      ).services.find((s) => s.id === "payment-service");
      const removed = payment?.findings.find((f) => f.code === "diff.op-removed-consumed");
      expect(removed, diffed.stdout).toBeDefined();
      expect(removed!.message).toContain("refundPayment");
      expect(removed!.details).toEqual(['edge order-service → payment-service ("refundPayment")']);

      // The unscoped spine run — the PR recipe's other step — is red on the same
      // branch, at the join that now dangles.
      const { code, payload } = await validateJson(p, "--all", "--spine");
      expect(code).toBe(1);
      const dangling = findingsOf(payload).filter((f) => f.code === "spine.op-undefined");
      expect(dangling.map((f) => f.message).join("\n")).toContain("refundPayment");
    } finally {
      await p.destroy();
    }
  });
});

describe("a join-free fleet.yaml keeps its meaning", () => {
  // 0.2.0-alpha.18's shipped examples/fleet.yaml, comments dropped: every call
  // bare, the kafka edges among them, as that release could only state them.
  const ALPHA_18_EXAMPLE = `services:
  - checkout-web
  - order-service
  - payment-service
  - id: identity-service
    subsystem: platform
  - id: notification-service
    subsystem: platform
subsystems:
  - platform
externals:
  - customer
  - stripe
  - kafka
calls:
  - customer -> checkout-web
  - checkout-web -> order-service
  - checkout-web -> payment-service
  - order-service -> payment-service
  - order-service -> identity-service
  - payment-service -> identity-service
  - payment-service -> stripe
  - payment-service -> kafka
  - order-service -> kafka
  - kafka -> order-service
  - kafka -> notification-service
`;

  // Captured by running `loam seed` at 6b28d65 (0.2.0-alpha.18) over the file
  // above. NEVER regenerate it from the current code: a pin re-derived from the
  // thing it pins proves nothing.
  const ALPHA_18_EDGES = [
    "  svc_checkout_web -[calls]-> svc_order_service",
    "  svc_checkout_web -[calls]-> svc_payment_service",
    "  ext_customer -[calls]-> svc_checkout_web",
    "  ext_kafka -[calls]-> svc_notification_service",
    "  ext_kafka -[calls]-> svc_order_service",
    "  svc_order_service -[calls]-> svc_identity_service",
    "  svc_order_service -[calls]-> ext_kafka",
    "  svc_order_service -[calls]-> svc_payment_service",
    "  svc_payment_service -[calls]-> svc_identity_service",
    "  svc_payment_service -[calls]-> ext_kafka",
    "  svc_payment_service -[calls]-> ext_stripe",
  ];

  it("0.2.0-alpha.18's example draws the edges that release drew, in its order, and says what it said", async () => {
    const p = await makeProject({ "services/.gitkeep": "" });
    try {
      const seeded = await seed(p, ALPHA_18_EXAMPLE);
      expect(seeded.code, seeded.stdout).toBe(0);
      // The sentence a join-free file always printed, word for word.
      expect(seeded.stdout).toContain("5 service(s), 11 call(s), from fleet.yaml");
      const drawn = (await p.read("architecture/landscape.likec4"))
        .replace(/\r\n/g, "\n")
        .split("\n")
        .filter((line) => / -\[\w+\]-> /.test(line) && !line.startsWith("//"));
      expect(drawn).toEqual(ALPHA_18_EDGES);

      // And there is nothing for the lens to check, which it says in words
      // rather than reading as a pass (exit 0: an unstated join is not a wrong
      // one, the same answer `--base` gives an empty scope).
      const text = await runLoam(p.workDir, "validate", "--all", "--spine");
      expect(text.code).toBe(0);
      expect(text.stdout).toContain("joins: none stated — nothing was checked");
    } finally {
      await p.destroy();
    }
  });
});
