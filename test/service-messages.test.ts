/**
 * What the SERVICE target's own messages say, where saying it wrong sends the
 * reader to a file that is not broken — or leaves them with no sentence at all.
 *
 * Every case here is a wrong answer that was measured on the tree
 * (verification 2026-09-04):
 *
 *  - `spine.landscape-invalid` named `landscape.likec4` however the
 *    `architecture/` project actually broke, and the real path appeared nowhere
 *    in the payload. `explain` tells an agent to "fix the file the message
 *    names", and the file it named parses.
 *  - `c4.invalid` on a model written in BOTH shapes — an element kind declared
 *    beside an `extend` — reported `Could not resolve reference to Element`,
 *    which reads as a typo in the fqn. Nothing said the kind is what makes the
 *    file standalone, and standalone is what makes the `extend` unresolvable.
 *  - a HEALTHY intra-service flow was invisible on every loam surface: the
 *    use-case axis reports only what is wrong with one, so a team that wrote
 *    the slot correctly could not tell it from a team whose views were never
 *    read at all.
 */
import { describe, expect, it } from "vitest";
import { LANDSCAPE, LIVING_OPENAPI, LIVING_SPEC, makeProject, runLoam, type Project } from "./helpers/harness.js";

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
  details?: string[];
  locations?: Array<{ path: string; role: string }>;
}

interface Payload {
  targets: Array<{ kind: string; id: string; findings: JsonFinding[] }>;
}

function codeFor(stdout: string, code: string): JsonFinding[] {
  return (JSON.parse(stdout) as Payload).targets.flatMap((t) => t.findings).filter((f) => f.code === code);
}

const SVC = "payment-service";
const DIR = `services/${SVC}`;

/** A tagged flow over the model below — one hop, every step backed. */
const FLOW = `views {
  dynamic view uc_authorize {
    #req-PAY-AUTH
    title 'Authorize a payment'
    paymentService.api -> paymentService.ledger 'writes'
  }
}
`;

/** The service's own model, standalone, declaring the tag the flow carries. */
const MODEL = `specification {
  element softwareSystem
  element container
  tag req-PAY-AUTH
}

model {
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
    api = container 'api'
    ledger = container 'ledger'
  }
  paymentService.api -> paymentService.ledger 'writes'
}
`;

/** A living spec whose one requirement carries the id the flow's `#req-` tag names. */
const SPEC = LIVING_SPEC.replace(
  "### Requirement: Authorize a payment\n",
  "### Requirement: Authorize a payment\nRequirement-ID: PAY-AUTH\n",
);

/** A document under `architecture/` that does not parse — a use-case hop naming nothing. */
function broken(id: string): string {
  return `views {\n  dynamic view ${id} {\n    nosuch -> alsonosuch 'x'\n  }\n}\n`;
}

async function project(extra: Record<string, string> = {}): Promise<Project> {
  return makeProject({
    "architecture/landscape.likec4": LANDSCAPE,
    [`${DIR}/model.likec4`]: MODEL,
    [`${DIR}/spec.md`]: SPEC,
    [`${DIR}/openapi.yaml`]: LIVING_OPENAPI,
    ...extra,
  });
}

describe("spine.landscape-invalid names the document that broke", () => {
  // Catches: the filename hardcoded back. `land` is the whole `architecture/`
  // PROJECT, so the broken document is as often a use case as the map, and the
  // message is the only thing that says which.
  it("names the architecture/ file with the errors, not landscape.likec4, and locates it", async () => {
    const p = await project({ "architecture/usecases/bad.likec4": broken("uc_bad") });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [spine, ...rest] = codeFor(res.stdout, "spine.landscape-invalid");
      expect(rest).toEqual([]);
      expect(spine?.message).toContain("architecture/usecases/bad.likec4 has ");
      expect(spine?.message).not.toContain("landscape.likec4 has ");
      // The broken file first, the service second: without the pair the payload
      // carried the service directory alone and the real path nowhere.
      expect(spine?.locations).toEqual([
        { path: "architecture/usecases/bad.likec4", role: "primary" },
        { path: DIR, role: "scope" },
      ]);
      // One broken document, so the lines stay bare — the fleet arm's rule.
      expect(spine?.details?.length).toBeGreaterThan(0);
      for (const line of spine?.details ?? []) expect(line.startsWith("L")).toBe(true);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  // Catches: a single file's name standing in for two. One `L8:` across two
  // documents is unactionable, which is why the fleet arm prefixes them.
  it("names both documents and prefixes every detail line when two are broken", async () => {
    const p = await project({
      "architecture/usecases/bad.likec4": broken("uc_bad"),
      "architecture/usecases/worse.likec4": broken("uc_worse"),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [spine] = codeFor(res.stdout, "spine.landscape-invalid");
      // "a, b have N error(s)": the verb agrees with the SERIES the message
      // names, not with the count after it.
      expect(spine?.message).toContain("architecture/usecases/bad.likec4, architecture/usecases/worse.likec4 have ");
      expect(spine?.message).not.toContain(".likec4 has ");
      const prefixed = (spine?.details ?? []).filter((line) => line.startsWith("architecture/usecases/"));
      expect(prefixed.length).toBe(spine?.details?.length);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("c4.invalid explains a model written in both shapes at once", () => {
  // Catches: the hint dropped, or fired on a model whose shape is not what
  // made the `extend` unresolvable.
  it("names the kind declaration as what makes the file standalone", async () => {
    const p = await project({
      [`${DIR}/model.likec4`]: "specification {\n  element container\n}\n\nmodel {\n  extend paymentService {\n    api = container 'api'\n  }\n}\n",
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [invalid] = codeFor(res.stdout, "c4.invalid");
      expect(invalid?.details?.some((line) => line.includes("Could not resolve reference to Element"))).toBe(true);
      const hint = invalid?.details?.find((line) => line.includes("standalone shape"));
      expect(hint).toContain("declares an element kind in `specification { }`");
      expect(hint).toContain("Drop the kind declaration to extend the fleet map");
    } finally {
      await p.destroy();
    }
  }, 60_000);

  // Catches: the hint appended AFTER the errors, where `capDetails`' ten-line
  // limit drops it — and a model written in both shapes at once is exactly the
  // model that produces more than ten errors, because every kind and every
  // reference in it stops resolving. The hint showed only on toy files.
  it("keeps the hint when the cascade is longer than the details cap", async () => {
    const containers = Array.from({ length: 12 }, (_, i) => `    c${i} = container 'c${i}'\n`).join("");
    const p = await project({
      [`${DIR}/model.likec4`]: `specification {\n  element widget\n}\n\nmodel {\n  extend paymentService {\n${containers}  }\n}\n`,
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [invalid] = codeFor(res.stdout, "c4.invalid");
      // The cap really did fire, so the assertion below is about the case the
      // defect was in and not about a file small enough to escape it.
      expect(invalid?.details?.at(-1)).toMatch(/^… \(\+\d+ more\)$/);
      expect(invalid?.details?.[0]).toContain("declares an element kind in `specification { }`");
    } finally {
      await p.destroy();
    }
  }, 60_000);

  // Catches: the byte probe firing on any broken standalone model. A model with
  // no `extend` in it has a different fault and must not be told to drop one.
  it("says nothing about extend when the model never writes one", async () => {
    const p = await project({
      [`${DIR}/model.likec4`]: "specification {\n  element container\n}\n\nmodel {\n  api = container 'api' {\n}\n",
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [invalid] = codeFor(res.stdout, "c4.invalid");
      expect(invalid?.details?.some((line) => line.includes("standalone shape"))).toBe(false);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("c4.valid counts the flows this service had graded", () => {
  // Catches: a healthy flow with no surface at all. The clause sits OUTSIDE the
  // parentheses because the counts inside are facts about model.likec4 alone.
  it("adds the tagged-flow count, and the model's own counts are untouched", async () => {
    const p = await project({ [`${DIR}/usecases/authorize.likec4`]: FLOW });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [valid] = codeFor(res.stdout, "c4.valid");
      expect(valid?.message).toBe(`${SVC}: C4 model valid (3 elements · 1 relationships) · 1 tagged flow(s) graded`);
      // Graded, not merely loaded: nothing is wrong with the flow, so the count
      // is the only place it appears.
      expect(codeFor(res.stdout, "usecase.step-unbacked")).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  // Catches: `· 0 tagged flow(s) graded` on every service in a fleet that has
  // never written one.
  it("says nothing when the service declares no use case", async () => {
    const p = await project();
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(codeFor(res.stdout, "c4.valid")[0]?.message).toBe(`${SVC}: C4 model valid (3 elements · 1 relationships)`);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});
