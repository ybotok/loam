/**
 * The work packet lists SERVICES, and a person, somebody else's system and the
 * fleet's own infrastructure are not services.
 *
 * Measured on a pilot fleet (2026-10-28): a feature's `delta.likec4` drew a
 * monitoring system and a human operator with tagged op-edges into the service
 * the feature built, and `loam tasks` listed both as services with work units —
 * "<operator> calls '<op>' on <service>", a claim about a repository that does
 * not exist and that no evidence could ever answer. `service.exists` had already
 * learned the census's reading of a drawn element (`core/c4/resolve/systems.ts`,
 * `readDeltaSystem`, which coherence's `service.no-requirement-delta` asks too);
 * the CALLER of a `c4.calls` claim and `loam delta`'s list of the services a
 * feature touches had not. Reproduced here on the harness fixture — nothing from
 * that fleet may enter this repository.
 *
 * The other direction is pinned as well, because over-filtering is the cheap
 * way to make the first half pass: a service of ours calling OUT to an
 * `#external` system is still that service's work.
 */
import { afterEach, describe, expect, it } from "vitest";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";
import { featureChecklist } from "../src/core/verify/checklist.js";
import { featureDirOf } from "../src/core/kernel/ids/dirs.js";
import { join } from "node:path";

const DELTA = `specification {
  element softwareSystem
  element person
  element database
  tag FEAT-1
  tag external
}

model {
  paymentService = softwareSystem 'payment-service'
  paymentSplitService = softwareSystem 'payment-split-service' {
    #FEAT-1
    description 'Splits a payment across payees'
  }
  operator = person 'Payments operator' {
    #FEAT-1
  }
  monitoring = softwareSystem 'monitoring' {
    #FEAT-1
    #external
  }
  splitsDb = database 'splits-db' {
    #FEAT-1
  }

  paymentService -> paymentSplitService 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }
  operator -> paymentSplitService 'Reviews splits' {
    #FEAT-1
    metadata { op 'listSplits' }
  }
  monitoring -> paymentSplitService 'Polls health' {
    #FEAT-1
    metadata { op 'getHealth' }
  }
  splitsDb -> paymentSplitService 'Change feed' {
    #FEAT-1
    metadata { op 'onSplitChanged' }
  }
  paymentSplitService -> monitoring 'Pushes metrics' {
    #FEAT-1
    metadata { op 'pushMetrics' }
  }
}

views {
  view feat_1 {
    include *
  }
}
`;

const NOT_SERVICES = ["Payments operator", "monitoring", "splits-db"];
const SERVICES = ["payment-service", "payment-split-service"];
/**
 * `loam delta`'s list is narrower than the packet's by design: a service with a
 * `specs/` delta or a TAGGED element of the C4 delta. payment-service only
 * calls here, so it is a caller in the packet and not a service the delta draws.
 */
const DELTA_SERVICES = ["payment-split-service"];

let project: Project | undefined;
afterEach(async () => {
  await project?.destroy();
  project = undefined;
});

async function fixture(): Promise<Project> {
  project = await makeProject({ ...coherentFixture(), "features/FEAT-1-split/delta.likec4": DELTA });
  return project;
}

describe("loam tasks — only services become services", () => {
  it("lists no person, #external system or unbound store among the packet's services", async () => {
    const p = await fixture();
    const res = await runLoam(p.workDir, "tasks", "FEAT-1", "--json");
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as { services: string[]; units: Array<{ subject: string; kind: string; claim: string }> };
    expect(out.services).toEqual(SERVICES);
    expect(out.units.filter((u) => NOT_SERVICES.includes(u.subject))).toEqual([]);
  });

  it("keeps a service's own call OUT to an #external system as that service's work", async () => {
    const p = await fixture();
    const res = await runLoam(p.workDir, "tasks", "FEAT-1", "--json");
    const out = JSON.parse(res.stdout) as { units: Array<{ subject: string; kind: string; claim: string }> };
    const calls = out.units.filter((u) => u.kind === "c4.calls").map((u) => [u.subject, u.claim]);
    expect(calls).toEqual([
      ["payment-service", "payment-service calls 'createSplit' on payment-split-service"],
      ["payment-split-service", "payment-split-service calls 'pushMetrics' on monitoring"],
    ]);
  });

  it("refuses a lens on a non-service as an unknown service, not as an empty packet", async () => {
    const p = await fixture();
    const res = await runLoam(p.workDir, "tasks", "FEAT-1", "--service", "monitoring", "--json");
    expect(res.code).toBe(1);
    expect((JSON.parse(res.stdout) as { error: { code: string } }).error.code).toBe("unknown-target");
  });

  it("asks verify no question a non-service caller would have to answer", async () => {
    const p = await fixture();
    const checklist = await featureChecklist(p.docsDir, featureDirOf(join(p.docsDir, "features/FEAT-1-split")), "FEAT-1");
    expect(checklist.claims.filter((c) => NOT_SERVICES.includes(c.subject))).toEqual([]);
  });
});

describe("a container's call is its service's call", () => {
  it("files the call of a new service's container under the service, not under the container's title", async () => {
    // fraud-service has no directory yet and no specs/ — the delta is the only
    // place it exists — so the resolver fell back to the container's own title
    // and the claim was filed under a service called "api".
    const delta = `specification {
  element softwareSystem
  element container
  tag FEAT-1
}

model {
  paymentSplitService = softwareSystem 'payment-split-service' {
    #FEAT-1
  }
  fraudService = softwareSystem 'fraud-service' {
    #FEAT-1
    api = container 'api'
  }

  fraudService.api -> paymentSplitService 'Scores a split' {
    #FEAT-1
    metadata { op 'scoreSplit' }
  }
}

views {
  view feat_1 {
    include *
  }
}
`;
    project = await makeProject({ ...coherentFixture(), "features/FEAT-1-split/delta.likec4": delta });
    const res = await runLoam(project.workDir, "tasks", "FEAT-1", "--json");
    const out = JSON.parse(res.stdout) as { services: string[]; units: Array<{ subject: string; kind: string; claim: string }> };
    expect(out.services).not.toContain("api");
    expect(out.units.filter((u) => u.kind === "c4.calls").map((u) => [u.subject, u.claim])).toEqual([
      ["fraud-service", "fraud-service calls 'scoreSplit' on payment-split-service"],
    ]);
  });
});

describe("loam delta — the services a feature touches", () => {
  it("names only services when it asks which one to project onto", async () => {
    const p = await fixture();
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--json");
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout) as { error: { code: string; message: string }; services: string[] };
    expect(out.services).toEqual(DELTA_SERVICES);
    for (const name of NOT_SERVICES) expect(out.error.message).not.toContain(name);
  });

  it("lists only services beside a projection", async () => {
    const p = await fixture();
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service", "--json");
    expect(res.code).toBe(0);
    expect((JSON.parse(res.stdout) as { services: string[] }).services).toEqual(DELTA_SERVICES);
  });
});
