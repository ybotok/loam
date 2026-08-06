/**
 * Deep invariant tests for `loam explore` (src/commands/explore.ts, logic in
 * src/core/explore.ts).
 *
 * `explore` runs BEFORE the first document exists. It reads the fleet map and
 * the living contracts around a proposed change and reports the ring of
 * services one hop out, the features already in flight over the same ground,
 * and how far each service's documentation has got — then stops, because which
 * of those neighbours a feature really touches is a judgement about intent.
 *
 * So what is pinned here is not advice. It is that every answer the command
 * gives is derived from something on disk, that the answers it cannot derive
 * are visible as gaps rather than as silence, and that a command sitting in
 * front of authoring never writes.
 *
 * Families:
 *  - the ring: seeds first, then one hop in both directions, each in id order
 *  - the per-service view: maturity (the same rung `list` gives), operations, edges
 *  - seeds and operations that resolve to nothing — reported, never refused
 *  - overlaps with features already carrying a delta for an explored service
 *  - refusals, and that the illegal-id one lands before anything is read
 *  - a landscape that is absent or unreadable — where silence must not promote
 *  - the --json envelope
 */
import { describe, expect, it } from "vitest";
import {
  coherentFixture,
  LIVING_OPENAPI,
  makeProject,
  runLoam,
  treeHashes,
  type Project,
} from "./helpers/harness.js";

const SVC = "payment-service";

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

/** `loam explore … --json`, parsed. */
async function explored(p: Project, ...args: string[]): Promise<Record<string, unknown>> {
  const res = await runLoam(p.workDir, "explore", ...args, "--json");
  return JSON.parse(res.stdout);
}

interface ExploredService {
  id: string;
  reason: string;
  known: boolean;
  maturity: string | null;
  missing: string[];
  modelled: boolean;
  operations: string[];
  inbound: Array<{ service: string; op: string | null; title: string | null }>;
  outbound: Array<{ service: string; op: string | null; title: string | null }>;
}

function service(json: Record<string, unknown>, id: string): ExploredService {
  return (json.services as ExploredService[]).find((s) => s.id === id)!;
}

/**
 * Two hops in both directions around payment-service, so "one hop" is a claim
 * with something to exclude: reporting-service sits behind ledger-service and
 * storefront-web sits in front of checkout-web, and only one of those two is a
 * seed's neighbour.
 */
const RING_LANDSCAPE = `specification {
  element softwareSystem
}

model {
  storefront = softwareSystem 'storefront-web'
  checkout = softwareSystem 'checkout-web'
  gateway = softwareSystem 'api-gateway'
  payments = softwareSystem 'payment-service'
  ledger = softwareSystem 'ledger-service'
  audit = softwareSystem 'audit-service'
  reporting = softwareSystem 'reporting-service'

  storefront -> checkout 'Redirects to'
  checkout -> payments 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  gateway -> payments 'Calls capturePayment' {
    metadata { op 'capturePayment' }
  }
  payments -> ledger 'Posts entries' {
    metadata { op 'postEntry' }
  }
  payments -> audit 'Emits audit events'
  ledger -> reporting 'Feeds nightly rollup'
}

views {
  view landscape {
    include *
  }
}
`;

function ringFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": RING_LANDSCAPE,
    "services/payment-service/spec.md": "# payment-service\n",
    "services/checkout-web/spec.md": "# checkout-web\n",
    "services/api-gateway/spec.md": "# api-gateway\n",
    "services/ledger-service/spec.md": "# ledger-service\n",
  };
}

describe("the ring", () => {
  it("puts the seeds first and the one-hop ring after, each in id order", async () => {
    await withProject(ringFixture(), async (p) => {
      // Seeds handed over in the wrong order on purpose: the answer is sorted,
      // not echoed, or two agents exploring the same pair get two answers.
      const json = await explored(p, SVC, "checkout-web");
      expect((json.services as ExploredService[]).map((s) => [s.id, s.reason])).toEqual([
        ["checkout-web", "seed"],
        ["payment-service", "seed"],
        ["api-gateway", "calls-seed"],
        ["audit-service", "called-by-seed"],
        ["ledger-service", "called-by-seed"],
        ["storefront-web", "calls-seed"],
      ]);
    });
  });

  it("stops at one hop — the ring is the blast radius, not the fleet", async () => {
    await withProject(ringFixture(), async (p) => {
      const json = await explored(p, SVC);
      expect(json.neighbours).toEqual(["api-gateway", "audit-service", "checkout-web", "ledger-service"]);
      // Two hops out on either side. Including them would turn a list somebody
      // is meant to weigh service by service into the whole connected component.
      expect(json.neighbours).not.toContain("reporting-service");
      expect(json.neighbours).not.toContain("storefront-web");
    });
  });

  it("names both directions separately, because they are different questions", async () => {
    await withProject(ringFixture(), async (p) => {
      const svc = service(await explored(p, SVC), SVC);
      // Inbound: who breaks if this service's contract changes. Outbound: whose
      // contract this service is already relying on.
      expect(svc.inbound).toEqual([
        { service: "checkout-web", op: "authorizePayment", title: "Calls authorizePayment" },
        { service: "api-gateway", op: "capturePayment", title: "Calls capturePayment" },
      ]);
      expect(svc.outbound).toEqual([
        { service: "ledger-service", op: "postEntry", title: "Posts entries" },
        // An edge nobody tied to an operation still counts as a neighbour; it
        // just cannot be checked against a contract, and `op: null` says so.
        { service: "audit-service", op: null, title: "Emits audit events" },
      ]);
    });
  });

  it("reads only — the docs repo is byte-identical afterwards", async () => {
    await withProject(ringFixture(), async (p) => {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "explore", SVC);
      expect(res.code, res.out).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    });
  });
});

/**
 * Two services with byte-identical directories that must grade differently, and
 * only the fleet map says why: `svc-called` carries an inbound edge tied to an
 * operation, so it owes an `openapi.yaml`; `svc-quiet` carries an edge nobody
 * tied to one, so it does not.
 */
const LADDER_LANDSCAPE = `specification {
  element softwareSystem
}

model {
  gateway = softwareSystem 'gateway'
  called = softwareSystem 'svc-called'
  quiet = softwareSystem 'svc-quiet'

  gateway -> called 'Calls doThing' {
    metadata { op 'doThing' }
  }
  gateway -> quiet 'Publishes events'
}

views {
  view landscape {
    include *
  }
}
`;

/** One service per interesting rung, graded from presence and provenance only. */
function ladderFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": LADDER_LANDSCAPE,
    "services/gateway/model.likec4": "model {}\n",
    "services/gateway/spec.md": "# gateway\n",
    "services/svc-called/model.likec4": "model {}\n",
    "services/svc-called/spec.md": "# svc-called\n",
    "services/svc-quiet/model.likec4": "model {}\n",
    "services/svc-quiet/spec.md": "# svc-quiet\n",
    // empty: the directory exists (a stray untracked file makes it), no artifact does
    "services/svc-empty/notes.txt": "todo\n",
    // vouched: the triple, declared sources, verified WITH the digest behind it
    "services/svc-vouched/model.likec4": "model {}\n",
    "services/svc-vouched/spec.md":
      "---\nservice: svc-vouched\nstatus: verified\nsources:\n  - src/\nsources_digest: 0123456789abcdef\n---\n\n# svc-vouched\n",
    "services/svc-vouched/openapi.yaml": "openapi: 3.1.0\n",
  };
}

const LADDER_SEEDS = ["gateway", "svc-called", "svc-empty", "svc-quiet", "svc-vouched"];

describe("the per-service view", () => {
  it("grades every service exactly as `loam list` does — one ladder, not two", async () => {
    await withProject(ladderFixture(), async (p) => {
      const explore = await explored(p, ...LADDER_SEEDS);
      const list = JSON.parse((await runLoam(p.workDir, "list", "services", "--json")).stdout);

      const rung = (s: { id: string; maturity: unknown; missing: unknown }): unknown[] => [
        s.id,
        s.maturity,
        s.missing,
      ];
      const fromExplore = (explore.services as ExploredService[]).map(rung);
      const fromList = (list.services as ExploredService[]).map(rung);

      // Parity IS the reason core/maturity.ts was extracted from list.ts: the
      // rung is a fleet dial, `list` prints it per service and `explore` prints
      // it for a service somebody is about to build against, and a dial with two
      // readings is not a dial.
      expect(fromExplore).toEqual(fromList);

      // …and the readings are not trivially equal. svc-called and svc-quiet hold
      // identical directories and land on different rungs, so agreement here is
      // agreement about the landscape evidence too, not just about the files.
      expect(fromExplore).toEqual([
        ["gateway", "documented", ["sources: in the spec.md frontmatter"]],
        ["svc-called", "partial", ["openapi.yaml"]],
        ["svc-empty", "empty", ["model.likec4", "spec.md"]],
        ["svc-quiet", "documented", ["sources: in the spec.md frontmatter"]],
        ["svc-vouched", "vouched", []],
      ]);
    });
  });

  it("says which services the fleet map can see, so an unmodelled one is not read as uncalled", async () => {
    await withProject(ladderFixture(), async (p) => {
      const json = await explored(p, "svc-called", "svc-vouched");
      expect(service(json, "svc-called").modelled).toBe(true);
      // In the docs repo, absent from the map: no edge into it can be checked,
      // which is a different fact from "nothing calls it".
      expect(service(json, "svc-vouched").modelled).toBe(false);
    });
  });

  it("lists the operations the living contract exposes today", async () => {
    await withProject(coherentFixture(), async (p) => {
      expect(service(await explored(p, SVC), SVC).operations).toEqual(["authorizePayment"]);
    });
  });

  it("excludes an operation marked x-loam-remove — it is a slot on its way out, not one to call", async () => {
    const files = coherentFixture();
    files["services/payment-service/openapi.yaml"] =
      LIVING_OPENAPI +
      `  /payments/void:
    post:
      operationId: voidPayment
      x-loam-remove: true
      responses:
        "200":
          description: Gone
`;
    await withProject(files, async (p) => {
      expect(service(await explored(p, SVC), SVC).operations).toEqual(["authorizePayment"]);
      // And it is not something --op can steer a feature at either: a removal
      // marker is the one shape where "this service defines it" is already false.
      const byOp = await explored(p, "--op", "voidPayment");
      expect(byOp.seeds).toEqual([]);
      expect(byOp.unresolvedOperations).toEqual(["voidPayment"]);
    });
  });

  it("says a contract does not parse instead of reporting it as a service with no endpoints", async () => {
    // This is the field the loam-feature protocol tells an agent to read before
    // deciding whether an operation it is about to add already exists. An
    // unreadable contract yields an EMPTY operation list, indistinguishable
    // from a service that genuinely exposes nothing — so answering `[]` over a
    // YAML error is how `authorizePayment` gets authored as ADDED when the
    // living contract already defines it, and `list` still grades the service
    // `documented` because `has.openapi` is presence-only.
    const files = coherentFixture();
    // Broken YAML, not a well-formed document with an odd shape: `paths:` as a
    // sequence still parses, and `readOpenapi` correctly reads that as a
    // contract defining nothing rather than one it could not read.
    files["services/payment-service/openapi.yaml"] = "openapi: 3.1.0\npaths:\n  /a: {unclosed\n";
    await withProject(files, async (p) => {
      const svc = service(await explored(p, SVC), SVC);
      expect(svc.operations).toEqual([]);
      expect(svc.openapi.unreadable).toBe(true);

      // and the text view says it where the `exposes:` line would have been
      const text = await runLoam(p.workDir, "explore", SVC);
      expect(text.code, text.out).toBe(0);
      expect(text.out).toContain("openapi.yaml does not parse");
      expect(text.out).not.toContain("exposes:");
    });

    // A readable contract is not accused of the same thing.
    await withProject(coherentFixture(), async (p) => {
      expect(service(await explored(p, SVC), SVC).openapi.unreadable).toBe(false);
    });
  });

  it("gives a service with no directory no rung at all — `empty` would be a claim about nothing", async () => {
    await withProject(ringFixture(), async (p) => {
      const svc = service(await explored(p, SVC), "audit-service");
      expect(svc.known).toBe(false);
      // null, not "empty": "exists, nothing in it" is the one state a caller
      // most needs to tell this apart from.
      expect(svc.maturity).toBeNull();
      expect(svc.missing).toEqual([]);
    });
  });
});

describe("seeds and operations that resolve to nothing", () => {
  it("reports a seed naming no services/<id>/ with its near misses instead of refusing", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "explore", "payment-serivce", "--json");
      // Not a refusal: the seed may be a service the feature INTRODUCES. A typo
      // produces exactly the same shape, and the near-miss list is what tells
      // the two apart — so it is reported, and reporting it exits 0.
      expect(res.code, res.out).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.unknown).toEqual([{ id: "payment-serivce", nearest: ["payment-service"] }]);
      expect(service(json, "payment-serivce").known).toBe(false);
    });
  });

  it("scaffolds an unknown seed as --new-service, and a known one as --touches", async () => {
    await withProject(coherentFixture(), async (p) => {
      // The two are different scaffolds. Getting it wrong leaves a feature with
      // a requirement delta for a service that has no directory to archive into.
      expect((await explored(p, "payment-serivce")).scaffold).toBe(
        "loam new FEAT-000 --new-service payment-serivce",
      );
      expect((await explored(p, SVC)).scaffold).toBe("loam new FEAT-000 --touches payment-service");
    });
  });

  it("keeps `unknown` to the seeds — a ring member with no directory is usually an external system", async () => {
    await withProject(ringFixture(), async (p) => {
      const json = await explored(p, SVC);
      expect(service(json, "audit-service").known).toBe(false);
      // Nobody typed `audit-service`; the fleet map drew an edge to it. Calling
      // that a possible typo sends a reader looking for a mistake they did not
      // make, so only seeds land in `unknown`.
      expect(json.unknown).toEqual([]);
    });
  });

  it("names the feature id in the scaffold when --as says which one", async () => {
    await withProject(coherentFixture(), async (p) => {
      expect((await explored(p, SVC, "--as", "FEAT-42")).scaffold).toBe(
        "loam new FEAT-42 --touches payment-service",
      );
    });
  });

  it("suggests a command `loam new` actually accepts, placeholder feature id and all", async () => {
    // `scaffold` is documented as the literal `loam new` line, and AGENTS.md's
    // rule is that an instruction loam prints and loam refuses is a defect. The
    // obvious placeholder is the trap: `loam new FEAT-000` comes back
    // `invalid-option`, so the last line of every default run — the one an
    // agent is most likely to paste — was a command that could not be run.
    await withProject(coherentFixture(), async (p) => {
      const { scaffold } = await explored(p, SVC);
      const res = await runLoam(p.workDir, ...scaffold.split(" ").slice(1), "--json");
      expect(res.code, `\`${scaffold}\` was refused:\n${res.out}`).toBe(0);
      expect(JSON.parse(res.stdout).ok).toBe(true);
    });
  });

  it("reports an operation no living contract defines, rather than guessing an owner", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "explore", "--op", "refundPayment", "--json");
      expect(res.code, res.out).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.unresolvedOperations).toEqual(["refundPayment"]);
      expect(json.seeds).toEqual([]);
      expect(json.services).toEqual([]);
    });
  });
});

describe("--op", () => {
  it("resolves to the service whose living contract defines the operation", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = await explored(p, "--op", "authorizePayment");
      // The map says who CALLS an operation; the question here is who DEFINES
      // it, so the answer comes from the contracts. checkout-web calls
      // authorizePayment and is not the seed.
      expect(json.seeds).toEqual([SVC]);
      expect(json.unresolvedOperations).toEqual([]);
      expect(service(json, "checkout-web").reason).toBe("calls-seed");
    });
  });

  it("does not resolve through a feature's contract — only the living one owns an operation", async () => {
    await withProject(coherentFixture(), async (p) => {
      // FEAT-1 proposes createSplit on payment-split-service. Until it archives,
      // no living contract defines it, and answering with the feature's own
      // delta would seed an exploration from a service that does not exist yet.
      const json = await explored(p, "--op", "createSplit");
      expect(json.seeds).toEqual([]);
      expect(json.unresolvedOperations).toEqual(["createSplit"]);
    });
  });

  it("folds an operation seed into a service seed rather than exploring it twice", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = await explored(p, SVC, "--op", "authorizePayment");
      expect(json.seeds).toEqual([SVC]);
      expect((json.services as ExploredService[]).filter((s) => s.id === SVC)).toHaveLength(1);
    });
  });
});

describe("features already in flight", () => {
  it("names the active features carrying a delta for an explored service", async () => {
    const files = {
      ...coherentFixture(),
      "features/FEAT-7-tighten/intent.md":
        "---\nfeature: FEAT-7\nstatus: proposed\n---\n\n# tighten authorization\n",
      "features/FEAT-7-tighten/specs/payment-service/spec.md": "# delta\n",
    };
    await withProject(files, async (p) => {
      const json = await explored(p, SVC);
      expect(json.overlaps).toEqual([{ feature: "FEAT-7", services: [SVC] }]);
    });
  });

  it("stays quiet about features that touch nothing in the exploration", async () => {
    await withProject(coherentFixture(), async (p) => {
      // FEAT-1 exists and carries a delta — for payment-split-service, which is
      // neither a seed nor in payment-service's ring.
      const json = await explored(p, SVC);
      expect(json.overlaps).toEqual([]);
    });
  });
});

describe("refusals", () => {
  it("refuses with nothing to explore from, and writes nothing", async () => {
    await withProject(coherentFixture(), async (p) => {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "explore", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout)).toMatchObject({
        ok: false,
        error: { code: "invalid-option" },
      });
      expect(await treeHashes(p.docsDir)).toEqual(before);
    });
  });

  it("refuses a seed that could not be a service directory at all — before it reads anything", async () => {
    await withProject(coherentFixture(), async (p) => {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "explore", "../etc", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout)).toMatchObject({
        ok: false,
        error: { code: "invalid-option" },
      });
      expect(await treeHashes(p.docsDir)).toEqual(before);
    });

    // The same argument against a docsDir that is not a docs repo. If the id
    // guard ran after the repo gate the answer here would be `services-missing`
    // — an id that reaches `servicePaths` has to be refused before any path is
    // built from it, not after the repo happens to look fine.
    await withProject({}, async (p) => {
      const guarded = await runLoam(p.workDir, "explore", "../etc", "--json");
      expect(JSON.parse(guarded.stdout).error.code).toBe("invalid-option");
      // …and the gate is genuinely armed in this fixture, so the ordering claim
      // above is about ordering rather than about a gate that never fires.
      const gated = await runLoam(p.workDir, "explore", SVC, "--json");
      expect(JSON.parse(gated.stdout).error.code).toBe("services-missing");
    });
  });

  it("refuses an --as that `loam new` would refuse, rather than printing it back", async () => {
    // `--as` is interpolated into the `loam new` line this command PRINTS, and
    // the loam-feature protocol teaches an agent to pass its own `$1` into it.
    // Unguarded, `explore` hands back a command `new` rejects — loam telling an
    // agent to run something loam refuses. `agent-commands-runnable` cannot
    // catch this class: it scans literal source strings, and this line is
    // assembled from argv at runtime.
    await withProject(coherentFixture(), async (p) => {
      for (const bad of ["not a feature", "FEAT", "FEAT-1 --touches everything", "../../x-1"]) {
        const res = await runLoam(p.workDir, "explore", SVC, "--as", bad, "--json");
        expect(res.code, `--as '${bad}' was accepted`).toBe(1);
        expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
      }

      // The grammar is `new`'s own, from core/ids.ts, so an id one command
      // accepts is accepted by the other. A second spelling here would drift.
      const ok = await runLoam(p.workDir, "explore", SVC, "--as", "BUG-42", "--json");
      expect(ok.code, ok.out).toBe(0);
      expect(JSON.parse(ok.stdout).scaffold).toContain("loam new BUG-42");
    });
  });
});

describe("a landscape it could not read", () => {
  it("says the map is absent, derives no ring, and promotes nobody", async () => {
    const files = ladderFixture();
    delete files["architecture/landscape.likec4"];
    await withProject(files, async (p) => {
      const json = await explored(p, "svc-quiet");
      expect(json.landscape).toEqual({ present: false, parses: false });
      expect(json.neighbours).toEqual([]);

      // The fail-open that matters. With the map readable, svc-quiet's only
      // inbound edge carries no operation, which is PROOF nobody calls it and it
      // grades `documented` with no openapi.yaml. With no map there is no proof
      // of anything, so the contract is still owed and it stays at `partial` —
      // a missing file must never promote a service.
      expect(service(json, "svc-quiet").maturity).toBe("partial");
      expect(service(json, "svc-quiet").missing).toEqual(["openapi.yaml"]);
    });

    await withProject(ladderFixture(), async (p) => {
      expect(service(await explored(p, "svc-quiet"), "svc-quiet").maturity).toBe("documented");
    });
  });

  it("says the map does not parse, and takes the same conservative reading", async () => {
    const files = ladderFixture();
    files["architecture/landscape.likec4"] = "this is not likec4 at all {{{\n";
    await withProject(files, async (p) => {
      const json = await explored(p, "svc-quiet");
      // present and parses are separate fields because the fixes differ: a map
      // nobody has written yet versus one somebody broke.
      expect(json.landscape).toEqual({ present: true, parses: false });
      expect(json.neighbours).toEqual([]);
      expect(service(json, "svc-quiet").maturity).toBe("partial");
      expect(service(json, "svc-quiet").modelled).toBe(false);
    });
  });

  it("exits 0 and says so before the first service, not after the last", async () => {
    const files = ladderFixture();
    delete files["architecture/landscape.likec4"];
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "explore", "svc-quiet");
      // Not a refusal: a fleet with no map is a fleet at the start of adoption,
      // and the one command that runs before any document exists cannot demand
      // a document. But a reader who takes the empty neighbour list at face
      // value concludes the change is contained when nothing checked that, so
      // the warning has to arrive first.
      expect(res.code, res.out).toBe(0);
      expect(res.out.indexOf("landscape.likec4")).toBeLessThan(res.out.indexOf("svc-quiet"));
    });
  });
});

describe("the machine contract", () => {
  it("names the command that ran, and carries the suggested line as `scaffold`", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "explore", SVC, "--json");
      const json = JSON.parse(res.stdout);
      expect(res.code, res.out).toBe(0);
      expect(json).toMatchObject({ contractVersion: "1.0", ok: true, command: "explore" });
      expect(json.docsDir).toBe(p.docsDir);
      // The payload field is `scaffold`, not `command`. The envelope is built by
      // spreading the payload over `{ command: "explore", … }`, so a payload key
      // called `command` would silently overwrite the envelope's — the consumer
      // switch on which command answered would start reading a `loam new` line.
      expect(json.scaffold).toBe("loam new FEAT-000 --touches payment-service");
      expect(json.command).toBe("explore");
    });
  });
});
