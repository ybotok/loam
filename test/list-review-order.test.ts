/**
 * `loam list --needs-work --review-order` — the blast-radius review queue.
 *
 * Two properties are load-bearing. The ORDER is derived from three joins the
 * repo already makes elsewhere (drawn edges, drawn `consumes` subscriptions,
 * living `Consumes:` requirement lines against declared `action: send`
 * messages) and counts DISTINCT known services — so the same caller proven
 * three ways is one dependant, and an actor or unbound system is none. And the
 * DEFAULT is frozen: `fanIn`/`reviewRank` exist only under the flag, so bare
 * `loam list --json` stays byte-identical to a tree that never heard of it.
 */
import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";
import { fleetFanIn } from "../src/core/dependencies/fanin.js";

/**
 * Four services. The map draws: b→a with an op, c→a plain, a→c carrying
 * `consumes 'a.evt'` (THE ARROW FOLLOWS THE MESSAGE — the TARGET is the
 * consumer, events.ts's rule, so that edge is fan-in on a from c and never a
 * call into c), and an edge from a system bound to no services/ directory,
 * which counts for nobody. d subscribes to a.evt by requirement line alone —
 * no edge — and a-svc's asyncapi declares it `action: send`.
 *
 * Expected fan-in: a=3 (b by op edge, c once across both edges, d by the
 * requirement join), b=c=d=0.
 */
const REVIEW_LANDSCAPE = `specification {
  element softwareSystem
}

model {
  aSvc = softwareSystem 'a-svc' {
    metadata { service 'a-svc' }
  }
  bSvc = softwareSystem 'b-svc' {
    metadata { service 'b-svc' }
  }
  cSvc = softwareSystem 'c-svc' {
    metadata { service 'c-svc' }
  }
  dSvc = softwareSystem 'd-svc' {
    metadata { service 'd-svc' }
  }
  legacyGateway = softwareSystem 'legacy-gateway'

  bSvc -> aSvc 'calls' {
    metadata { op 'doThing' }
  }
  cSvc -> aSvc 'reads'
  aSvc -> cSvc 'a.evt topic' {
    metadata { consumes 'a.evt' }
  }
  legacyGateway -> aSvc 'legacy calls'
}
`;

const A_ASYNCAPI = `asyncapi: 3.0.0
info:
  title: a-svc events
  version: "1.0"
channels:
  evt:
    address: a.evt.v1
    messages:
      Evt:
        $ref: '#/components/messages/Evt'
operations:
  sendEvt:
    action: send
    channel:
      $ref: '#/channels/evt'
components:
  messages:
    Evt:
      name: a.evt
      payload:
        type: object
`;

const D_SPEC = `---
service: d-svc
status: draft
---

# d-svc

## Requirements

### Requirement: React to the event
The service SHALL react to the event.

Consumes: a.evt

#### Scenario: reacts
- **Given** the event
- **When** it arrives
- **Then** the service reacts
`;

function reviewFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": REVIEW_LANDSCAPE,
    "services/a-svc/asyncapi.yaml": A_ASYNCAPI,
    "services/b-svc/.keep": "",
    "services/c-svc/.keep": "",
    "services/d-svc/spec.md": D_SPEC,
  };
}

async function reviewJson(p: Project, ...args: string[]): Promise<Record<string, any>> {
  const run = await runLoam(p.workDir, "list", ...args, "--json");
  expect(run.code).toBe(0);
  return JSON.parse(run.stdout);
}

type Row = Record<string, any>;

describe("the ranked queue", () => {
  it("puts the most-depended-on service first, with contiguous 1-based ranks matching array order", async () => {
    const p = await makeProject(reviewFixture());
    const payload = await reviewJson(p, "--needs-work", "--review-order");
    const rows = payload.services as Row[];
    expect(rows.map((r) => r.id)).toEqual(["a-svc", "b-svc", "c-svc", "d-svc"]);
    expect(rows[0]).toMatchObject({ id: "a-svc", fanIn: 3, reviewRank: 1 });
    // c-svc is the target of a delivery edge only — a pure event sink, not a
    // called service — so it carries a proven zero, not a phantom dependant.
    expect(rows[2]).toMatchObject({ id: "c-svc", fanIn: 0 });
    expect(rows.map((r) => r.reviewRank)).toEqual([1, 2, 3, 4]);
    await p.destroy();
  });

  it("ties break by id and the output is byte-stable across runs", async () => {
    const p = await makeProject(reviewFixture());
    const one = await runLoam(p.workDir, "list", "--needs-work", "--review-order", "--json");
    const two = await runLoam(p.workDir, "list", "--needs-work", "--review-order", "--json");
    expect(one.stdout).toBe(two.stdout);
    const rows = (JSON.parse(one.stdout).services as Row[]).filter((r) => r.fanIn === 0);
    // The zero-fan-in services, in compareIds order — no readdir order, no clock.
    expect(rows.map((r) => r.id)).toEqual(["b-svc", "c-svc", "d-svc"]);
    await p.destroy();
  });

  it("counts distinct services, not edges — a second op edge from the same caller changes nothing", async () => {
    const files = reviewFixture();
    files["architecture/landscape.likec4"] = REVIEW_LANDSCAPE.replace(
      "  cSvc -> aSvc 'reads'",
      "  bSvc -> aSvc 'calls again' {\n    metadata { op 'doOther' }\n  }\n  cSvc -> aSvc 'reads'",
    );
    const p = await makeProject(files);
    const payload = await reviewJson(p, "--needs-work", "--review-order");
    expect((payload.services as Row[])[0]).toMatchObject({ id: "a-svc", fanIn: 3 });
    await p.destroy();
  });

  it("ranks off the requirement join alone when there is no landscape — positive evidence, not a refusal", async () => {
    const files = reviewFixture();
    delete files["architecture/landscape.likec4"];
    const p = await makeProject(files);
    const payload = await reviewJson(p, "--needs-work", "--review-order");
    const rows = payload.services as Row[];
    // d's `Consumes: a.evt` against a-svc's `action: send` still counts; the
    // absent map contributes nothing to the edge joins and nothing fails.
    expect(rows[0]).toMatchObject({ id: "a-svc", fanIn: 1, reviewRank: 1 });
    expect(rows.filter((r) => r.fanIn === 0).map((r) => r.id)).toEqual(["b-svc", "c-svc", "d-svc"]);
    await p.destroy();
  });

  it("contains one unreadable artifact to that artifact's evidence — per read, not per slice", async () => {
    const p = await makeProject(reviewFixture());
    // d-svc grows an arch.spec.md that is not UTF-8. Its memoized read
    // REJECTS — and a memoized rejection rejects again on every await, the
    // hazard the scorecard's contracts.ts doctrine names — so an uncontained
    // read would delete the whole queue from inside the pool. And the
    // containment is per READ on purpose: the slice is a CALLER's evidence
    // about other services' fan-in, so a slice-wide catch that discarded the
    // readable spec.md's `Consumes: a.evt` with the broken arch.spec.md
    // would silently under-report a-svc at 2. Honest is 3: only the broken
    // artifact's evidence is lost, the run exits 0, d's own row still ranks.
    // arch.spec.md rather than spec.md, deliberately: the enumeration reads
    // every spec.md's frontmatter, so breaking THAT refuses the whole
    // command upstream (`repository-unavailable`) before any slice is read.
    await writeFile(join(p.docsDir, "services", "d-svc", "arch.spec.md"), Buffer.from([0xff, 0xfe, 0x41]));
    const payload = await reviewJson(p, "--needs-work", "--review-order");
    const rows = payload.services as Row[];
    expect(rows[0]).toMatchObject({ id: "a-svc", fanIn: 3 });
    expect(rows.map((r) => r.id)).toContain("d-svc");
    await p.destroy();
  });

  it("refuses an unreadable landscape identically with and without the flag", async () => {
    const files = reviewFixture();
    delete files["architecture/landscape.likec4"];
    // The landscape is a DIRECTORY in the file's place. Bare `loam list`
    // refuses `repository-unavailable` when serviceViews' own load throws on
    // it, and a rendering flag must never change what the run refuses: a
    // contained null here once answered ok — with rows CHANGED, because the
    // silent `proven: false` flips apiExpected and the missing lists — over
    // the exact file the flagless run refuses on.
    files["architecture/landscape.likec4/.keep"] = "";
    const p = await makeProject(files);
    const bare = await runLoam(p.workDir, "list", "--needs-work", "--json");
    expect(bare.code).toBe(1);
    expect(JSON.parse(bare.stdout).error.code).toBe("repository-unavailable");
    const flagged = await runLoam(p.workDir, "list", "--needs-work", "--review-order", "--json");
    expect(flagged.code).toBe(1);
    expect(JSON.parse(flagged.stdout).error.code).toBe("repository-unavailable");
    await p.destroy();
  });
});

describe("the flag surface", () => {
  it("refuses --review-order without --needs-work, in both views", async () => {
    const p = await makeProject(reviewFixture());
    const jsonRun = await runLoam(p.workDir, "list", "--review-order", "--json");
    expect(jsonRun.code).toBe(1);
    const payload = JSON.parse(jsonRun.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("invalid-option");
    expect(payload.error.message).toContain("--needs-work");

    const textRun = await runLoam(p.workDir, "list", "--review-order");
    expect(textRun.code).toBe(1);
    expect(textRun.stdout).toBe("");
    expect(textRun.stderr).toContain("--needs-work");
    await p.destroy();
  });

  it("keeps the default payload frozen: no fanIn/reviewRank key anywhere without the flag", async () => {
    const p = await makeProject(reviewFixture());
    for (const args of [[], ["--needs-work"]] as string[][]) {
      const payload = await reviewJson(p, ...args);
      for (const row of payload.services as Row[]) {
        expect(Object.keys(row)).not.toContain("fanIn");
        expect(Object.keys(row)).not.toContain("reviewRank");
      }
    }
    await p.destroy();
  });

  it("prints the ranked worklist with a fan-in cell per row", async () => {
    const p = await makeProject(reviewFixture());
    const run = await runLoam(p.workDir, "list", "--needs-work", "--review-order");
    expect(run.code).toBe(0);
    const lines = run.stdout.split("\n");
    expect(lines[0]).toContain("review order");
    const aLine = lines.find((l) => l.includes("a-svc"));
    expect(aLine).toContain("fan-in: 3");
    // Rows arrive in queue order: a first, then the zero tie by id.
    const order = ["a-svc", "b-svc", "c-svc", "d-svc"].map((id) => lines.findIndex((l) => l.trimStart().startsWith(id)));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    await p.destroy();
  });
});

describe("fleetFanIn — the pure derivation", () => {
  const services = ["p", "q", "r"];
  const svcOf = (id: string): string => id;

  it("a consumes edge binds its target as the consumer and its source as the producer", () => {
    const fanIn = fleetFanIn({
      services,
      landscape: { parses: true, relationships: [{ source: "p", target: "q", consumes: "m" }], svcOf },
      contracts: new Map(),
    });
    // Join 2: q (target) subscribes to p (source) → fan-in on p.
    expect(fanIn.get("p")).toBe(1);
    // And ONLY join 2. On the event spine THE ARROW FOLLOWS THE MESSAGE (the
    // scaffolded landscape's doctrine: producer → topic, topic → consumer),
    // so a delivery edge's arrow is not a call into its target — reading it
    // as one ranked a pure event sink above real dependencies and handed a
    // bound broker service one phantom dependant per consumer.
    expect(fanIn.get("q")).toBe(0);
    expect(fanIn.get("r")).toBe(0);
  });

  it("self-edges and endpoints outside the known set prove nothing", () => {
    const fanIn = fleetFanIn({
      services,
      landscape: {
        parses: true,
        relationships: [
          { source: "p", target: "p", consumes: "m" },
          { source: "actor", target: "p" },
          { source: "p", target: "external" },
        ],
        svcOf,
      },
      contracts: new Map(),
    });
    expect([...fanIn.values()]).toEqual([0, 0, 0]);
  });

  it("an unparsed landscape zeroes the edge joins only — the contract join still counts", () => {
    const contracts = new Map([
      ["p", { sent: ["m"], consumed: [] }],
      ["q", { sent: [], consumed: ["m"] }],
    ]);
    const parsed = fleetFanIn({
      services,
      landscape: { parses: true, relationships: [{ source: "r", target: "p" }], svcOf },
      contracts,
    });
    expect(parsed.get("p")).toBe(2); // r by edge, q by message
    const unparsed = fleetFanIn({ services, landscape: { parses: false }, contracts });
    expect(unparsed.get("p")).toBe(1); // q only — "nobody could look" is not "nothing is wrong"
  });

  it("duplicate evidence for one caller counts once", () => {
    const fanIn = fleetFanIn({
      services,
      landscape: {
        parses: true,
        relationships: [
          { source: "q", target: "p" },
          { source: "q", target: "p" },
        ],
        svcOf,
      },
      contracts: new Map([
        ["p", { sent: ["m"], consumed: [] }],
        ["q", { sent: [], consumed: ["m"] }],
      ]),
    });
    expect(fanIn.get("p")).toBe(1);
  });
});
