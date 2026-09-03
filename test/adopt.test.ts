/**
 * Tests for `loam adopt` (src/commands/adopt.ts, src/core/brief/) — the
 * bootstrap half of the two flows.
 *
 * `adopt` used to promise an extractor: read the code, emit the C4. That is not
 * a thing loam does. Nothing deterministic can read a legacy service and say
 * what its architecture MEANS, and an extractor that guesses produces a model
 * nobody can trust and everybody has to re-check. So adopt produces a BRIEF: the
 * work an agent has to do, stated precisely enough that the result is checkable.
 *
 * What that makes worth pinning is the difference between a brief and a hint:
 *
 *  - it names every target path AND whether the file is already there, because
 *    the one unrecoverable outcome is an agent overwriting a document a human
 *    wrote;
 *  - it states the GRAMMAR of each artifact, since every check downstream is a
 *    check of that grammar — and the model example it hands out has to parse,
 *    or the brief is teaching the agent to fail `loam validate`;
 *  - it reports what the landscape already says about this service, so the
 *    baseline binds to the fleet instead of describing a parallel one;
 *  - it is emphatic about `sources`, the only mechanical tie to the code;
 *  - it names the checks that follow, by code, and then names what loam CANNOT
 *    check — because everything in that second list is honesty the validator
 *    will never supply.
 *
 * And it writes nothing. A brief that touched the docs repo would be doing the
 * work it exists to hand over.
 */
import { describe, expect, it, afterEach } from "vitest";
import { join } from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import {
  coherentFixture,
  makeProject,
  makeTmpDir,
  runLoam,
  treeHashes,
  type Project,
} from "./helpers/harness.js";
import { loadFile } from "../src/core/c4/likec4.js";

const SVC = "payment-service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>, opts: { service?: string } = {}): Promise<Project> {
  const p = await makeProject(files, opts);
  cleanups.push(() => p.destroy());
  return p;
}

/** The brief as the machine contract — what every test below reads. */
async function brief(p: Project, ...args: string[]): Promise<Record<string, any>> {
  const res = await runLoam(p.workDir, "adopt", ...args, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout);
}

/** Everything the brief says about one artifact. */
function target(b: Record<string, any>, artifact: string): Record<string, any> {
  const t = b.targets.find((x: { artifact: string }) => x.artifact === artifact);
  expect(t, `no target for ${artifact}`).toBeDefined();
  return t;
}

describe("the work it hands over", () => {
  it("names every artifact a baseline is made of, the fleet map last", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    expect(b.targets.map((t: { artifact: string }) => t.artifact)).toEqual([
      "model.likec4",
      "spec.md",
      "arch.spec.md",
      "openapi.yaml",
      "asyncapi.yaml",
      "adrs/",
      "runbook.md",
      "health.yaml",
      // The eighth: not this service's file, but the one write without which the
      // other seven are invisible to every cross-service check.
      "landscape.likec4",
    ]);
  });

  it("puts every target under the service's own directory — except the fleet map, which is shared", async () => {
    // Repo-relative because the contract is diffed across machines; the absolute
    // anchor is `docsDir`, reported once.
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    expect(b.path).toBe(`services/${SVC}`);
    for (const t of b.targets) {
      if (t.artifact === "landscape.likec4") {
        expect(t.path).toBe("architecture/landscape.likec4");
        continue;
      }
      expect(t.path.startsWith(`services/${SVC}/`)).toBe(true);
    }
    expect(b.docsDir).toBe(p.docsDir);
  });

  it("reports an artifact that is already there as present, and asks for a diff instead of a rewrite", async () => {
    // The failure this prevents is unrecoverable: an agent replacing a document a
    // human wrote, with no diff for anyone to review.
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p);
    expect(target(b, "spec.md").exists).toBe(true);
    expect(target(b, "spec.md").action).toBe("diff");
    expect(target(b, "runbook.md").exists).toBe(false);
    expect(target(b, "runbook.md").action).toBe("create");
    expect(JSON.stringify(b).toLowerCase()).toContain("do not overwrite");
  });

  it("writes nothing at all — a brief is a request for work, not the work", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const before = await treeHashes(p.docsDir);
    await runLoam(p.workDir, "adopt");
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });
});

describe("the shape of each artifact", () => {
  it("spells the requirement grammar every later check is a check of", async () => {
    const p = await project({}, { service: SVC });
    const shape = target(await brief(p), "spec.md").shape.join("\n");
    expect(shape).toContain("### Requirement:");
    expect(shape).toContain("#### Scenario:");
    expect(shape).toContain("Operations:");
  });

  it("spells both C4 spines: the operation on an edge and the service on an element", async () => {
    const p = await project({}, { service: SVC });
    const shape = target(await brief(p), "model.likec4").shape.join("\n");
    expect(shape).toContain("metadata { op");
    expect(shape).toContain("metadata { service");
  });

  it("hands out a model example that actually parses — the brief must not teach a file loam rejects", async () => {
    const p = await project({}, { service: SVC });
    const example = target(await brief(p), "model.likec4").example as string;
    const dir = await makeTmpDir("loam-brief-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "model.likec4");
    await writeFile(path, example, "utf8");
    const loaded = await loadFile(path);
    expect(loaded.errors.map((e) => e.message)).toEqual([]);
    // and it is a model of THIS service, bound to this directory
    expect(loaded.elements.some((e) => e.service === SVC)).toBe(true);
  });

  it("says operationId is one token spelled three ways, not three names", async () => {
    const p = await project({}, { service: SVC });
    const shape = target(await brief(p), "openapi.yaml").shape.join("\n");
    expect(shape).toContain("operationId");
    expect(shape).toMatch(/identical|same/i);
  });
});

describe("what already exists around the service", () => {
  it("shows the landscape elements that stand for it, so the baseline binds to reality", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p);
    expect(b.landscape.present).toBe(true);
    expect(b.landscape.elements.map((e: { id: string }) => e.id)).toContain("paymentService");
  });

  it("names the operations other services already call on it — the OpenAPI has to define them", async () => {
    // An adopted contract that omits an operation the fleet already calls breaks
    // `spine.op-undefined` the moment it lands. The brief says so up front.
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p);
    expect(b.landscape.inbound).toContainEqual(
      expect.objectContaining({ from: "checkout-web", op: "authorizePayment" }),
    );
    expect(b.landscape.expects).toEqual(["authorizePayment"]);
  });

  it("reports the calls out of the service too — they are edges the model owes", async () => {
    const p = await project(coherentFixture(), { service: "checkout-web" });
    const b = await brief(p);
    expect(b.landscape.outbound).toContainEqual(
      expect.objectContaining({ to: SVC, op: "authorizePayment" }),
    );
  });

  it("says plainly when nothing in the landscape models this service yet", async () => {
    // Adopting a service the fleet map has never heard of is the common case, and
    // it is an ERROR at `loam validate --all` until an element exists.
    const p = await project(coherentFixture(), { service: "billing-service" });
    const b = await brief(p);
    expect(b.landscape.elements).toEqual([]);
    expect(b.landscape.modelled).toBe(false);
    expect(JSON.stringify(b)).toContain("landscape.service-unmodelled");
  });

  it("degrades honestly when the landscape does not parse, instead of reporting an empty fleet", async () => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = "model {\n  broken !!! not likec4\n";
    const p = await project(files, { service: SVC });
    const b = await brief(p);
    expect(b.landscape.present).toBe(true);
    expect(b.landscape.parses).toBe(false);
    expect(b.landscape.elements).toEqual([]);
    // "nothing models it" would be a lie about a document nobody could read
    expect(b.landscape.modelled).toBe(null);
  });

  it("decides `modelled` the way validate does — a nearest-ancestor binding wins over a descendant's title", async () => {
    // orderService is bound to order-service and holds a container TITLED
    // 'payment-service'. Every element→service join in loam resolves that
    // container to order-service (the binding is nearer than the title), so
    // `validate --all` reports payment-service unmodelled. The brief used to
    // read each element's OWN binding-or-title instead, call payment-service
    // modelled and edgeless, and tell the agent "do not add a second element"
    // — for a service whose one gating error is that no element resolves to it.
    const files: Record<string, string> = {
      "architecture/landscape.likec4": [
        "specification {",
        "  element softwareSystem",
        "  element container",
        "  tag external",
        "}",
        "",
        "model {",
        "  orderService = softwareSystem 'Orders' {",
        "    metadata { service 'order-service' }",
        "    paymentService = container 'payment-service'",
        "  }",
        "  billing = softwareSystem 'billing' {",
        "    #external",
        "  }",
        "  orderService -> billing 'Invoices'",
        "}",
        "",
        "views {",
        "  view landscape {",
        "    include *",
        "  }",
        "}",
        "",
      ].join("\n"),
      "services/order-service/spec.md": "---\nservice: order-service\nstatus: draft\n---\n",
      "services/payment-service/spec.md": "---\nservice: payment-service\nstatus: draft\n---\n",
    };
    const p = await project(files, { service: SVC });
    const b = await brief(p);
    expect(b.landscape.modelled).toBe(false);
    expect(b.landscape.touched).toBe(null);
    expect(b.landscape.elements).toEqual([]);
    expect(b.landscape.instruction).toContain("Nothing in architecture/landscape.likec4 resolves to");
    expect(b.landscape.instruction).toContain("landscape.service-unmodelled");
    // …and the fleet run says the same thing about the same tree.
    const res = await runLoam(p.workDir, "validate", "--all", "--json");
    const json = JSON.parse(res.stdout) as {
      targets: Array<{ kind: string; findings: Array<{ code: string; subject?: string }> }>;
    };
    const land = json.targets.find((t) => t.kind === "landscape");
    expect(land, "the fleet cross-check did not run").toBeDefined();
    expect(land!.findings).toContainEqual(
      expect.objectContaining({ code: "landscape.service-unmodelled", subject: SVC }),
    );
    // Seen from order-service the container is ITS box, not a second element:
    // the brief lists the service-level element alone.
    const o = await brief(p, "--service", "order-service");
    expect(o.landscape.modelled).toBe(true);
    expect(o.landscape.elements.map((e: { id: string }) => e.id)).toEqual(["orderService"]);
    expect(o.landscape.touched).toBe(true);
  });
});

/**
 * The fourth landscape state: an element resolves to the service and no edge
 * in the map touches it. That is what `loam seed --from fleet.yaml` leaves for
 * every service nobody listed under `calls:`, and until 2026-09-03 the brief
 * read element existence as "the map owes nothing" — `instruction: null`, no
 * target, `inbound: []`, `outbound: []` in one payload. An agent following the
 * protocol to the letter then wrote a validating baseline and never drew one
 * edge, and `loam validate --all` stayed green over it.
 */
describe("an element the map draws and nothing touches", () => {
  /**
   * The coherent fixture plus a bound, edgeless element for billing-service.
   * LikeC4 orders an element body — tags, then properties, then nested
   * elements — so `tags` opens the element, the binding follows, and `body`
   * (containers, edges) closes it; `spec` lands inside the specification
   * block, because LikeC4 refuses a tag or kind nothing declared.
   */
  function edgelessFixture(at: { tags?: string; body?: string; spec?: string } = {}): Record<string, string> {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = files["architecture/landscape.likec4"]!
      .replace("  element person\n", `  element person\n${at.spec ?? ""}`)
      .replace(
        "  customer -> checkoutWeb 'Uses'",
        `  billingService = softwareSystem 'billing-service' {\n${at.tags ?? ""}    metadata { service 'billing-service' }\n${at.body ?? ""}  }\n\n  customer -> checkoutWeb 'Uses'`,
      );
    files["services/billing-service/spec.md"] = "---\nservice: billing-service\nstatus: draft\n---\n";
    return files;
  }

  /** A service model attesting ONE call across its boundary, from a container. */
  const BILLING_MODEL = `specification {
  element softwareSystem
  element container
}

model {
  billingService = softwareSystem 'billing-service' {
    metadata { service 'billing-service' }
    api = container 'api'
  }
  stripe = softwareSystem 'Stripe acquirer'
  billingService.api -> stripe 'Authorizes' {
    metadata { op 'authorize' }
  }
}
`;

  it("asks for the edges, and names the calls the service's own model already attests", async () => {
    const files = edgelessFixture();
    files["services/billing-service/model.likec4"] = BILLING_MODEL;
    const p = await project(files, { service: "billing-service" });
    const b = await brief(p);
    // `modelled` keeps its meaning — an element resolves — and the new key
    // says the thing the two empty edge arrays only implied.
    expect(b.landscape.modelled).toBe(true);
    expect(b.landscape.touched).toBe(false);
    expect(b.landscape.attested).toEqual([
      { direction: "out", counterpartId: "stripe", counterpart: "Stripe acquirer", title: "Authorizes", op: "authorize" },
    ]);
    const instruction: string = b.landscape.instruction;
    expect(instruction).toContain("billingService");
    expect(instruction).toContain("Stripe acquirer");
    expect(instruction).toContain("op 'authorize'");
    // …and the counterpart is handed over as the model spells it, never
    // matched to a landscape element: one word can name two things in two
    // documents, and that join is the agent's.
    expect(instruction).toMatch(/names a different thing in the map/);
    expect(instruction).toContain("landscape.service-isolated");
    // The target is back, as an edit, and its shape refuses the second box.
    const t = target(b, "landscape.likec4");
    expect(t.action).toBe("edit");
    expect(t.required).toBe(true);
    expect(t.shape.join("\n")).toContain("Do NOT add a second one");
    expect(t.shape.join("\n")).toContain("landscape.binding-duplicate");
    // The example is edges only, on the element that already exists.
    expect(t.example).toContain("billingService ->");
    expect(t.example).not.toContain("softwareSystem 'billing-service'");
  });

  it("spells the edge in the direction the model attests — an inbound call is `<caller> -> <element>`", async () => {
    // The attested arm used to hand out the outbound form alone, so an agent
    // carrying up an inbound call drew the dependency backwards — and because
    // `op` must be an operationId the TARGET's openapi.yaml defines, the
    // reversed edge then earned `spine.op-undefined` against the wrong service.
    const inbound = edgelessFixture();
    inbound["services/billing-service/model.likec4"] = BILLING_MODEL.replace(
      "billingService.api -> stripe 'Authorizes'",
      "stripe -> billingService.api 'Authorizes'",
    );
    let b = await brief(await project(inbound, { service: "billing-service" }));
    expect(b.landscape.attested).toEqual([
      { direction: "in", counterpartId: "stripe", counterpart: "Stripe acquirer", title: "Authorizes", op: "authorize" },
    ]);
    expect(b.landscape.instruction).toContain("<- Stripe acquirer (op 'authorize')");
    expect(b.landscape.instruction).toContain("<caller> -> billingService 'Calls <op>'");
    expect(b.landscape.instruction).not.toContain("billingService -> <callee>");

    // Calls both ways: both forms, so neither direction is guessed.
    const mixed = edgelessFixture();
    // The model's tail — the outbound edge's closing brace, then `model`'s —
    // is the one place a second relationship can be spliced.
    mixed["services/billing-service/model.likec4"] = BILLING_MODEL.replace(
      "  }\n}\n",
      "  }\n  stripe -> billingService.api 'Notifies' {\n    metadata { op 'settle' }\n  }\n}\n",
    );
    b = await brief(await project(mixed, { service: "billing-service" }));
    expect(b.landscape.attested.map((c: { direction: string }) => c.direction)).toEqual(["in", "out"]);
    expect(b.landscape.instruction).toContain("billingService -> <callee> 'Calls <op>'");
    expect(b.landscape.instruction).toContain("<caller> -> billingService 'Calls <op>'");
  });

  it("says draw NOTHING when the service attests no call — an invented edge is a dependency", async () => {
    const p = await project(edgelessFixture(), { service: "billing-service" });
    const b = await brief(p);
    expect(b.landscape.touched).toBe(false);
    expect(b.landscape.attested).toEqual([]);
    expect(b.landscape.instruction).toContain("draw NOTHING");
    expect(b.landscape.instruction).not.toContain("op 'authorize'");
    // It points at the walk stops that produce the evidence instead.
    expect(b.landscape.instruction).toMatch(/stops 4 and 7/);
    expect(target(b, "landscape.likec4").action).toBe("edit");
  });

  it("attests nothing off a model that does not parse — half a document is not evidence", async () => {
    const files = edgelessFixture();
    files["services/billing-service/model.likec4"] = "model {\n  broken !!! not likec4\n";
    const p = await project(files, { service: "billing-service" });
    const b = await brief(p);
    expect(b.landscape.touched).toBe(false);
    expect(b.landscape.attested).toEqual([]);
    expect(b.landscape.instruction).toContain("draw NOTHING");
  });

  it("names the element's tags loam does not read, and none of the ones it does", async () => {
    const files = edgelessFixture({ tags: "    #provisional #platform\n", spec: "  tag provisional\n  tag platform\n" });
    const p = await project(files, { service: "billing-service" });
    const b = await brief(p);
    expect(b.landscape.elements[0].tags).toEqual(["provisional", "platform"]);
    // A placeholder convention is the fleet's own; loam names the tag and
    // never interprets it. `#platform` is loam's, so it is not "unread".
    expect(b.landscape.instruction).toContain("#provisional");
    expect(b.landscape.instruction).not.toContain("#platform");
    expect(b.landscape.instruction).toContain("exclude element.tag = #<that>");
  });

  it("counts an intra-service edge as touching — the predicate `loam context` prints", async () => {
    // A service modelled as containers, with an edge between two of them: the
    // map draws an edge on this service, which is what `touched` is about.
    const files = edgelessFixture({
      body: "    api = container 'api'\n    db = container 'db'\n    api -> db 'reads'\n",
      spec: "  element container\n",
    });
    const p = await project(files, { service: "billing-service" });
    const b = await brief(p);
    expect(b.landscape.modelled).toBe(true);
    expect(b.landscape.touched).toBe(true);
    expect(b.landscape.instruction).toBe(null);
    expect(b.targets.map((t: { artifact: string }) => t.artifact)).not.toContain("landscape.likec4");
  });

  it("opens the service model only in the edgeless state", async () => {
    // payment-service has an inbound edge, so its model is never read here —
    // asserted through a model that would not parse if it were.
    const files = coherentFixture();
    files[`services/${SVC}/model.likec4`] = "model {\n  broken !!! not likec4\n";
    const p = await project(files, { service: SVC });
    const b = await brief(p);
    expect(b.landscape.touched).toBe(true);
    expect(b.landscape.attested).toEqual([]);
    expect(b.landscape.instruction).toBe(null);
  });

  it("is null, like `modelled`, when nothing could be read or nothing resolves", async () => {
    const unparseable = coherentFixture();
    unparseable["architecture/landscape.likec4"] = "model {\n  broken !!! not likec4\n";
    let b = await brief(await project(unparseable, { service: SVC }));
    expect(b.landscape.modelled).toBe(null);
    expect(b.landscape.touched).toBe(null);
    b = await brief(await project(coherentFixture(), { service: "billing-service" }));
    expect(b.landscape.modelled).toBe(false);
    expect(b.landscape.touched).toBe(null);
    expect(b.landscape.attested).toEqual([]);
  });

  it("the reproduction: a seeded service nobody listed under calls: is briefed the edges", async () => {
    // loam's own documented bootstrap. `calls:` is a human-authored list that
    // is incomplete by construction on day zero, so every service it omits
    // reaches `adopt` as a bound, edgeless element.
    const p = await project({ "services/.gitkeep": "", "features/.gitkeep": "" });
    await writeFile(
      join(p.workDir, "fleet.yaml"),
      "services:\n  - alpha-service\n  - beta-service\nexternals:\n  - kafka\ncalls:\n  - alpha-service -> kafka\n",
      "utf8",
    );
    const seeded = await runLoam(p.workDir, "seed", "--from", "fleet.yaml", "--json");
    expect(seeded.code, seeded.out).toBe(0);

    const beta = await brief(p, "--service", "beta-service");
    expect(beta.landscape.modelled).toBe(true);
    expect(beta.landscape.touched).toBe(false);
    expect(typeof beta.landscape.instruction).toBe("string");
    // seed writes no model, so nothing is attested and nothing is invented.
    expect(beta.landscape.attested).toEqual([]);
    expect(beta.landscape.instruction).toContain("draw NOTHING");
    expect(target(beta, "landscape.likec4").action).toBe("edit");

    const alpha = await brief(p, "--service", "alpha-service");
    expect(alpha.landscape.touched).toBe(true);
    expect(alpha.landscape.instruction).toBe(null);
    expect(alpha.targets.map((t: { artifact: string }) => t.artifact)).not.toContain("landscape.likec4");
  });
});

describe("the frontmatter it must write", () => {
  it("requires status draft, and says promotion is a human's command", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    expect(b.frontmatter.fields.status).toContain("draft");
    const text = JSON.stringify(b.frontmatter);
    expect(text).toContain("loam vouch");
    expect(text).toMatch(/last_verified|sources_digest/);
  });

  it("is emphatic about `sources`, and says why it is the field that matters", async () => {
    // Everything else loam checks is internal consistency, which a fluent fiction
    // satisfies perfectly. If the agent takes one instruction seriously it has to
    // be this one, so the brief has to argue for it, not just list it.
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const text = JSON.stringify(b.frontmatter);
    expect(text).toContain("sources");
    expect(text).toMatch(/only .*tie|internal consistency/i);
    expect(b.frontmatter.fields.sources).toMatch(/read/i);
  });
});

describe("what happens next, and what will never happen", () => {
  it("names the checks `loam validate --service` will run, by code", async () => {
    const p = await project({}, { service: SVC });
    const codes = (await brief(p)).checks.map((c: { code: string }) => c.code);
    for (const code of [
      "c4.invalid",
      "requirements.missing-scenarios",
      "spine.op-undefined",
      "sources.path-missing",
      "landscape.service-unmodelled",
    ]) {
      expect(codes).toContain(code);
    }
  });

  it("grades those checks, so the agent knows which ones stop it", async () => {
    const p = await project({}, { service: SVC });
    const checks = (await brief(p)).checks;
    expect(checks.some((c: { severity: string }) => c.severity === "error")).toBe(true);
    expect(checks.some((c: { severity: string }) => c.severity === "warn")).toBe(true);
  });

  it("attributes every check to the invocation that surfaces it — --service does not run the fleet cross-check", async () => {
    // landscape.service-unmodelled only fires under --all; a brief crediting it
    // to `--service <id>` sent agents chasing a finding that run never reports.
    const p = await project({}, { service: SVC });
    const checks = (await brief(p)).checks;
    for (const c of checks) {
      expect(["loam validate --service <id>", "loam validate --all"], c.code).toContain(c.via);
    }
    const byCode = (code: string): Record<string, any> =>
      checks.find((c: { code: string }) => c.code === code);
    expect(byCode("landscape.service-unmodelled").via).toBe("loam validate --all");
    expect(byCode("c4.invalid").via).toBe("loam validate --service <id>");
  });

  it("splits the prose the same way — the --all-only check is not promised to --service", async () => {
    const p = await project({}, { service: SVC });
    const res = await runLoam(p.workDir, "adopt");
    expect(res.code).toBe(0);
    expect(res.out).toContain("what `loam validate --service " + SVC + "` then checks");
    const allHeader = res.out.indexOf("and what only `loam validate --all` surfaces");
    expect(allHeader).toBeGreaterThan(-1);
    // the fleet check sits under the --all header, after every --service check
    expect(res.out.indexOf("landscape.service-unmodelled", allHeader)).toBeGreaterThan(allHeader);
    // The CHECK LIST above the header holds no --all-only code. (The fixture's
    // landscape does model this service, so the fleet-map target — which quotes
    // the same code in its shape rules — is not briefed at all here.)
    const serviceSection = res.out.slice(
      res.out.indexOf("what `loam validate --service " + SVC + "` then checks"),
      allHeader,
    );
    expect(serviceSection).not.toContain("landscape.service-unmodelled");
  });

  it("meters partial adoption honestly: a missing spec or openapi is a warn in the brief, as in validate", async () => {
    // The brief marks spec.md/openapi.yaml required (for a COMPLETE baseline);
    // validate grades their absence a warn. Both statements have to be made, or
    // the brief and the checker disagree about what "required" means.
    const p = await project({}, { service: SVC });
    const checks = (await brief(p)).checks;
    for (const code of ["service.no-spec", "service.no-openapi", "api.ops-unlinked"]) {
      const c = checks.find((x: { code: string }) => x.code === code);
      expect(c, `no check for ${code}`).toBeDefined();
      expect(c.severity, code).toBe("warn");
    }
  });

  it("lists what loam cannot check — the part where honesty is on the agent", async () => {
    const p = await project({}, { service: SVC });
    const unchecked = (await brief(p)).unchecked.join("\n").toLowerCase();
    expect(unchecked.length).toBeGreaterThan(0);
    // the three that matter most: truth, completeness, and the contract's body
    expect(unchecked).toMatch(/true|truth|actually/);
    expect(unchecked).toMatch(/complete/);
    expect(unchecked).toMatch(/schema|operationid/);
  });

  it("ends by handing the result to a person", async () => {
    const p = await project({}, { service: SVC });
    const res = await runLoam(p.workDir, "adopt");
    expect(res.code).toBe(0);
    expect(res.out).toContain(`loam validate --service ${SVC}`);
    expect(res.out).toContain(`loam vouch --service ${SVC}`);
  });
});

/**
 * The orientation block — the human view's own defect, and its fix.
 *
 * The default brief is 646 lines and 5,600 words to a terminal, unpaged, and
 * the two rows that tell a person what to do — `model.likec4 create MISSING`,
 * `spec.md create MISSING` — land around line 470, behind four hundred lines of
 * prose. `--json` is explicitly the agent contract, so nothing was being served
 * by leaving the human view unintroduced. Three sentences at the top say how
 * much is owed, what the table's flags mean, and what the rest of the page is.
 *
 * What these pin is that every number in it is DERIVED. A literal count would
 * be right until the next check is added and silently wrong forever after, and
 * a block a reader cannot trust is worse than no block: it costs the scroll to
 * verify it, on top of the scroll it was meant to save.
 */
describe("the orientation block the human view opens with", () => {
  /** The targets a baseline still owes — required, and either absent or (the fleet map) undrawn. */
  function owed(b: Record<string, any>): string[] {
    return b.targets
      .filter((t: { required: boolean; exists: boolean; action: string }) => t.required && (!t.exists || t.action === "edit"))
      .map((t: { artifact: string }) => t.artifact);
  }

  it("lands before the first section header, not four hundred lines into the page", async () => {
    const p = await project(coherentFixture(), { service: "billing-service" });
    const res = await runLoam(p.workDir, "adopt");
    expect(res.code, res.out).toBe(0);
    // Whole trimmed lines, not substrings: the block's own sentences quote the
    // names of the sections they stand for ("statements of what nothing
    // checks"), and a substring search would match those instead of the headers.
    const lines = res.out.split("\n").map((line: string) => line.trim());
    const orientation = lines.indexOf("read this first");
    expect(orientation).toBeGreaterThan(-1);
    for (const header of [
      "read the code in this order — nothing below is written from anything else",
      "artifacts",
      "what the fleet already says about this service",
      "frontmatter — on every markdown artifact",
      "what nothing checks",
    ]) {
      expect(lines.indexOf(header), header).toBeGreaterThan(orientation);
    }
  });

  it("counts what is owed off the brief's own targets, and names them", async () => {
    // A service the fleet map has never heard of: the common case, and the one
    // where the count is worth reading.
    const p = await project(coherentFixture(), { service: "billing-service" });
    const b = await brief(p);
    const res = await runLoam(p.workDir, "adopt");
    const flowed = res.out.replace(/\s+/g, " ");
    expect(flowed).toContain(
      `${String(owed(b).length)} of the ${String(b.targets.length)} artifacts below are required and not yet done: ${owed(b).join(", ")}.`,
    );
  });

  it("counts the fleet-map edit among them — the file exists and the work does not", async () => {
    // The trap this exists for: `architecture/landscape.likec4` is already there
    // for every repo after its first service, so `required && !exists` counts
    // two and the third — an ERROR at `loam validate --all` — goes unmentioned.
    const p = await project(coherentFixture(), { service: "billing-service" });
    const b = await brief(p);
    expect(target(b, "landscape.likec4").exists).toBe(true);
    expect(target(b, "landscape.likec4").action).toBe("edit");
    expect(owed(b)).toContain("landscape.likec4");
    const flowed = (await runLoam(p.workDir, "adopt")).out.replace(/\s+/g, " ");
    expect(flowed).toContain("3 of the 9 artifacts below are required and not yet done");
  });

  it("says so plainly when nothing is owed, rather than printing a count of zero", async () => {
    // payment-service in the coherent fixture has its model, its spec, its
    // contract and an element in the fleet map: the whole page is a diff.
    const p = await project(coherentFixture(), { service: SVC });
    expect(owed(await brief(p))).toEqual([]);
    const flowed = (await runLoam(p.workDir, "adopt")).out.replace(/\s+/g, " ");
    expect(flowed).toContain("None of the 8 artifacts below is both required and outstanding");
  });

  it("decodes the table's own convention, capitals included", async () => {
    const p = await project(coherentFixture(), { service: "billing-service" });
    const flowed = (await runLoam(p.workDir, "adopt")).out.replace(/\s+/g, " ");
    // The distinction the table renders as if it were emphasis.
    expect(flowed).toContain("`MISSING` in capitals is required and not there");
    expect(flowed).toContain("lowercase `missing` is optional and not there");
    // And what the fleet map's row is doing among this boundary's files.
    expect(flowed).toContain("not this boundary's own file");
    expect(flowed).toContain("landscape.service-unmodelled");
  });

  it("repeats the legend under the artifacts header, for the reader who scrolls back", async () => {
    const p = await project(coherentFixture(), { service: "billing-service" });
    const lines = (await runLoam(p.workDir, "adopt")).out.split("\n");
    const header = lines.findIndex((line: string) => line.trim() === "artifacts");
    expect(header).toBeGreaterThan(-1);
    const legend = lines.findIndex((line: string) => line.includes("MISSING required"));
    expect(legend).toBeGreaterThan(header);
    // Above the rows it decodes, not below them. Matched on whitespace rather
    // than a literal gap: the artifact column is padded to the longest name in
    // the table (`landscape.likec4` today), so a two-space literal asserts a
    // column width nobody chose and reddens when a longer artifact is briefed.
    const firstRow = lines.findIndex((line: string) => /model\.likec4\s+create\s+MISSING/.test(line));
    expect(firstRow, "the artifact rows follow the legend").toBeGreaterThan(legend);
  });

  it("sizes the rest of the page from the brief, and points an agent at the same targets", async () => {
    const p = await project(coherentFixture(), { service: "billing-service" });
    const b = await brief(p);
    const flowed = (await runLoam(p.workDir, "adopt")).out.replace(/\s+/g, " ");
    expect(flowed).toContain(`${String(b.walk.length)}-stop order to read the code in`);
    expect(flowed).toContain(`${String(b.checks.length)} named checks`);
    expect(flowed).toContain(`${String(b.unchecked.length)} statements of what nothing checks`);
    expect(flowed).toContain("loam adopt --service billing-service --json");
    expect(flowed).toContain("--targets");
  });

  it("adds to the default view and takes nothing out of it", async () => {
    // The long body is not the defect — it was unintroduced, not unwanted. Every
    // section the page carried before still has to be on it.
    const p = await project(coherentFixture(), { service: SVC });
    const res = await runLoam(p.workDir, "adopt");
    for (const section of [
      "read the code in this order",
      "artifacts",
      "what the fleet already says about this service",
      "frontmatter — on every markdown artifact",
      `what \`loam validate --service ${SVC}\` then checks`,
      "and what only `loam validate --all` surfaces",
      "what nothing checks",
      "when you are done",
    ]) {
      expect(res.out, section).toContain(section);
    }
    // and the never-overwrite rule keeps its place above the body
    expect(res.out).toContain("Do not overwrite an artifact that already exists");
  });
});

describe("the slash command that drives it", () => {
  it("is laid down by init and points at the protocol that ships with the binary", async () => {
    const dir = await makeTmpDir("loam-adopt-cmd-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    // `--create`: `--docs` joins an existing docs repo, and ./d does not exist.
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const file = await readFile(join(dir, ".claude", "commands", "loam-adopt.md"), "utf8");
    // The file is a pointer, so what it owes is the pointer and the spine — not
    // this release's flags, which are the part that goes stale in a repository
    // scaffolded once and never regenerated.
    expect(file).toContain("loam instructions loam-adopt $1");
    expect(file).toContain("status: draft");
    expect(file).toContain("sources");
  });

  it("and that protocol is reachable from the binary, with the flow intact", async () => {
    const dir = await makeTmpDir("loam-adopt-protocol-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    // Deliberately NOT wired: `loam instructions` is the one command that reads
    // nothing, because loam-adopt's own first step is to run `loam init` when
    // there is no config. A protocol reachable only from a configured repo
    // would be unreachable exactly when it is first needed.
    const res = await runLoam(dir, "instructions", "loam-adopt", SVC);
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain(`loam adopt --service ${SVC}`);
    expect(res.out).toContain(`loam validate --service ${SVC}`);
    expect(res.out).toContain(`loam vouch --service ${SVC}`);
    // the two instructions that make the difference between a baseline and a fiction
    expect(res.out).toContain("sources");
    expect(res.out).toContain("status: draft");
    // and the fleet-level run that catches a landscape edit which never landed
    expect(res.out).toContain("loam validate --all --json");
  });
});

describe("the machine contract", () => {
  it("--service overrides the configured service", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p, "--service", "billing-service");
    expect(b.service).toBe("billing-service");
    expect(b.path).toBe("services/billing-service");
  });

  it("refuses when no service is configured or passed — a brief for '<service>' is nobody's work", async () => {
    const p = await project({});
    const res = await runLoam(p.workDir, "adopt", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("invalid-option");
  });

  it("reports a missing loam.json under the same code as every other command", async () => {
    const dir = await makeTmpDir("loam-adopt-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const res = await runLoam(dir, "adopt", "--service", SVC, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("no-config");
  });

  it("refuses a docs repo that does not exist, rather than briefing a baseline into it", async () => {
    // Writing nothing is exactly why this stayed quiet. The brief is an
    // instruction to WRITE, so a docsDir nobody has is not a harmless read: it
    // handed over eight target paths under a directory that is not there, at
    // exit 0, with the near-miss warning silently switched off — `listServices`
    // throws and the warning collector swallows it.
    //
    // It gates on `docs`, not `services`: a docs repo whose `services/` is
    // still empty is the repo adopt exists to fill, and it is what every other
    // fixture in this file is.
    const p = await project({}, { service: SVC });
    await rm(p.docsDir, { recursive: true, force: true });
    const res = await runLoam(p.workDir, "adopt", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("docs-missing");
    expect(json.error.message).toContain(p.docsDir);
    // No brief alongside the refusal: "here is the work" over a repo that is
    // not there is the answer this exists to replace.
    expect(json.targets).toBeUndefined();
  });

  it("prints the same brief in prose when there is no --json", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const res = await runLoam(p.workDir, "adopt");
    expect(res.code).toBe(0);
    expect(res.out).toContain(SVC);
    expect(res.out).toContain("model.likec4");
    expect(res.out).toContain("### Requirement:");
    expect(res.out).toContain("sources");
    expect(res.out).toContain("authorizePayment");
  });

  it("carries every key it has always carried — the default payload is the frozen one", async () => {
    // Named one by one rather than counted. `--targets` narrows by OMISSION at
    // the command layer, so the way it could go wrong is by narrowing the
    // default too — and a length assertion would pass while the wrong five
    // keys survived.
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p);
    expect(Object.keys(b)).toEqual([
      "contractVersion",
      // Two envelope keys the emitter itself contributes to every command —
      // the binary's version and the payload's own discriminator. Only their
      // NAMES belong in a key list; what `version` must equal is
      // LOAM_VERSION, and test/envelope-identity.test.ts asserts it there
      // rather than pinning a literal that would go red on every release.
      "version",
      "ok",
      "command",
      "service",
      "docsDir",
      "path",
      "targets",
      "walk",
      "walkClose",
      "landscape",
      "frontmatter",
      "checks",
      "unchecked",
      "rule",
      "warnings",
    ]);
    // …and the invariant half is not merely present but populated: an empty
    // `checks` array is the same key with the contract gone.
    expect(b.checks.length).toBeGreaterThan(0);
    expect(b.unchecked.length).toBeGreaterThan(0);
    expect(b.walk.length).toBeGreaterThan(0);
  });
});

/**
 * `--targets` — the brief minus everything that is the same for every service.
 *
 * The measurement that produced it: one service of the five-service example
 * fleet is 42,873 bytes of `--json`, and 23 KB of that is `walk`, `checks`,
 * `unchecked`, `frontmatter`, `walkClose` and `rule` — module constants, byte
 * for byte identical for every service in every fleet. A twelve-service
 * adoption paid for them twelve times.
 *
 * The risk the flag carries is the one these tests are mostly about: the
 * unchecked list is loam shipping the statements of what no check will ever
 * tell you, and a narrowing flag that made it merely ABSENT would read as
 * "there is no such list" rather than "not repeated here" — quietly undoing
 * the one promise the brief keeps that no validator supplies.
 */
describe("--targets: only what varies by service", () => {
  it("carries exactly the variant keys, plus the pointer to the rest", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p, "--targets");
    expect(Object.keys(b)).toEqual([
      "contractVersion",
      "version",
      "ok",
      "command",
      "service",
      "docsDir",
      "path",
      "targets",
      "landscape",
      "warnings",
      "full",
    ]);
    // The invariant half is gone, named individually so a partial narrowing
    // cannot pass.
    for (const key of ["walk", "walkClose", "frontmatter", "checks", "unchecked", "rule"]) {
      expect(b[key], `${key} should be omitted under --targets`).toBeUndefined();
    }
    // And what remains is the part that is a function of this repository: the
    // targets still resolve under this service, and the landscape is still read.
    expect(b.service).toBe(SVC);
    expect(b.path).toBe(`services/${SVC}`);
    expect(target(b, "model.likec4").path).toBe(`services/${SVC}/model.likec4`);
    expect(b.landscape.elements.map((e: { id: string }) => e.id)).toContain("paymentService");
  });

  it("says how many statements of what nothing checks it left out, counted from the list itself", async () => {
    // The count is the load-bearing half of the pointer: "there is more" is a
    // sentence a reader can skip, "there are sixteen statements of what nothing
    // checks" is one they cannot. Compared against the FULL payload rather than
    // a literal, so adding a check or an unchecked statement can never leave
    // this sentence quietly stale.
    const p = await project(coherentFixture(), { service: SVC });
    const full = await brief(p);
    const narrow = await brief(p, "--targets");
    expect(narrow.full).toContain(`${String(full.unchecked.length)} statements of what nothing checks`);
    expect(narrow.full).toContain(`${String(full.checks.length)} named checks`);
    expect(narrow.full).toContain(`${String(full.walk.length)}-stop code walk`);
    // and it says the omission is once for the whole system, not once per
    // governed boundary — the reason the flag exists, stated where the agent
    // deciding what to run next reads it. "System" rather than "fleet"
    // deliberately: a modular monolith has one `service`, and telling its
    // adopter to run the full brief "once per fleet" would read as never.
    expect(narrow.full).toMatch(/once for the system/);
  });

  it("names a command the real CLI runs, and that returns what it promised", async () => {
    // `test/agent-commands-runnable.test.ts` makes this claim for every `loam …`
    // loam PRINTS: an instruction that does not parse is a defect. This one is
    // assembled at run time from the service id, so it is checked here instead —
    // and checked by running it, which also proves the pointer is honest rather
    // than merely syntactic.
    const p = await project(coherentFixture(), { service: SVC });
    const narrow = await brief(p, "--targets");
    const invocation = (narrow.full as string).split(" — ")[0]!.trim();
    const tokens = invocation.split(/\s+/);
    expect(tokens[0]).toBe("loam");
    const res = await runLoam(p.workDir, ...tokens.slice(1));
    expect(res.code, res.out).toBe(0);
    const restored = JSON.parse(res.stdout);
    // What the pointer promised is what came back, by count.
    expect(narrow.full).toContain(`${String(restored.unchecked.length)} statements of what nothing checks`);
    expect(narrow.full).toContain(`${String(restored.checks.length)} named checks`);
    expect(restored.rule).toBeDefined();
  });

  it("omits the same sections from the prose, and prints the pointer instead", async () => {
    // The two views have to agree about what the flag MEANS. A text view that
    // still printed the checks while `--json` dropped them would make
    // `--targets` two different flags depending on how you read the output.
    const p = await project(coherentFixture(), { service: SVC });
    const res = await runLoam(p.workDir, "adopt", "--targets");
    expect(res.code, res.out).toBe(0);
    // still there: the artifacts and what the fleet already says
    expect(res.out).toContain("artifacts");
    expect(res.out).toContain("what the fleet already says about this service");
    // Gone: the invariant half, one section HEADER each. Headers rather than
    // substrings, because the pointer that replaces them quotes the name of the
    // list it stands for — "15 statements of what nothing checks" contains the
    // header it is telling you about, and a substring assertion would read that
    // sentence as the section still being printed.
    const headers = res.out.split("\n").map((line: string) => line.trim());
    expect(headers).not.toContain("what nothing checks");
    expect(headers).not.toContain("frontmatter — on every markdown artifact");
    expect(headers).not.toContain(`what \`loam validate --service ${SVC}\` then checks`);
    expect(res.out).not.toContain("read the code in this order");
    // and in their place, the sentence that says they exist. Whitespace is
    // collapsed first because the pointer is WRAPPED for the terminal, so the
    // phrase this asserts straddles a newline in the real output — a raw
    // toContain would fail on a sentence that is present and correct.
    const flowed = res.out.replace(/\s+/g, " ");
    expect(flowed).toContain("the rest of the brief");
    expect(flowed).toContain("statements of what nothing checks");
  });

  it("prints no orientation block — bullet three describes sections this view omits", async () => {
    // The block says what the rest of the page is: a nine-stop walk, 45 checks,
    // seventeen statements of what nothing checks. Under `--targets` none of the
    // three is printed, so the sentence would be describing a page that is not
    // there — and `--targets` already has its own pointer for exactly that job.
    const p = await project(coherentFixture(), { service: SVC });
    const res = await runLoam(p.workDir, "adopt", "--targets");
    expect(res.code, res.out).toBe(0);
    expect(res.out.split("\n").map((line: string) => line.trim())).not.toContain("read this first");
  });

  it("changes nothing without the flag — the default view is untouched", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const res = await runLoam(p.workDir, "adopt");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("read the code in this order");
    expect(res.out).toContain("what nothing checks");
    expect(res.out).not.toContain("the rest of the brief");
  });
});
