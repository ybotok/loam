/**
 * The use-case axis end to end: `loam validate --all` over a docs repo whose
 * `architecture/usecases/*.likec4` files declare business flows, and the four
 * grades those flows earn.
 *
 * Every case here is a WRONG ANSWER that was reachable, not a shape assertion.
 * A `dynamic view` hop between two elements that exist, with no relationship
 * between them, is zero LikeC4 errors — the diagram renders and the project
 * parses — so `usecase.step-unbacked` is the only thing in the toolchain that
 * convicts it. The three suppressions are the other half: grading an untagged
 * view turns every brownfield fleet red on upgrade, dropping the
 * provider-must-exist guard warns about every hop into a database or an actor,
 * dropping the `publishes`/`consumes` exemption demands an HTTP operationId for
 * a Kafka message, and computing `step-unlinked` from the candidate
 * relationships rather than from the verdict reports one contested hop twice.
 *
 * Run through the real CLI over a real LikeC4 project rather than against the
 * two joins directly: `test/usecase-join.test.ts` and
 * `test/step-attribution.test.ts` already pin those, and what is unpinned
 * without this file is everything between them and a finding — the opt-in, the
 * guards, the vocabulary ladder, and the file each message names.
 */
import { describe, expect, it } from "vitest";
import { makeProject, runLoam } from "./helpers/harness.js";

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
  details: string[];
}

function useCaseFindings(stdout: string): JsonFinding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: JsonFinding[] }> };
  return payload.targets.flatMap((t) => t.findings).filter((f) => f.code.startsWith("usecase."));
}

function codeFor(stdout: string, code: string): JsonFinding[] {
  return useCaseFindings(stdout).filter((f) => f.code === code);
}

/**
 * One fleet map, drawn so that every shape the guards are about is present at
 * once: a service drawn as containers (the tier-2 join), a datastore, an
 * `#external` system, an actor, an edge carrying `metadata { op }`, one carrying
 * `metadata { consumes }`, and one carrying neither.
 *
 * Every `#cap-` tag any use case below writes is declared here, because LikeC4
 * refuses an undeclared tag and one `specification` block serves the whole
 * project — which is itself the authoring rule the use-case file format rests
 * on.
 */
const LANDSCAPE = `specification {
  element service
  element container
  element db
  element person
  tag external
  tag cap-checkout
  tag cap-checkot
  tag cap-payments-refunds
  tag cap-nothing
}

model {
  customer = person 'Customer'
  web = service 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  payments = service 'payment-service' {
    metadata { service 'payment-service' }
  }
  orders = service 'order-service' {
    metadata { service 'order-service' }
    api = container 'api'
    worker = container 'worker'
  }
  search = service 'search-service' {
    metadata { service 'search-service' }
    primary = container 'primary'
    replica = container 'replica'
  }
  ledger = db 'ledger-db'
  stripe = service 'Stripe' {
    #external
  }

  customer -> web 'Uses'
  web -> payments 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  web -> orders.api 'Places the order' {
    metadata { op 'createOrder' }
  }
  web -> orders.worker 'Enqueues the order'
  payments -> orders 'Notifies the order'
  orders -> payments 'Consumes payment.Refunded' {
    metadata { consumes 'payment.Refunded' }
  }
  orders -> ledger 'Writes the entry'
  web -> stripe 'Charges the card'
  web -> search.primary 'Queries the index' {
    metadata { op 'searchOrders' }
  }
  web -> search.replica
  payments -> search.primary 'Indexes the payment'
  payments -> search.replica 'Indexes into the replica'
}

views {
  view fleet {
    include *
  }
}
`;

/** A capability vocabulary that declares the tag the flows below mean to carry. */
const CAPABILITIES = `capabilities:
  checkout:
    description: Buying something
    owner: commerce
  identity/tokens:
    description: Issuing tokens
    owner: platform
`;

/** Two declared ids that flatten to ONE tag slug — the ambiguity nothing in a tag can resolve. */
const COLLIDING = `capabilities:
  payments/refunds:
    owner: payments
  payments-refunds:
    owner: payments
`;

function spec(service: string): string {
  return `---\nservice: ${service}\n---\n\n# ${service}\n`;
}

/**
 * The docs repo: the map, three real `services/<id>/` directories (the provider
 * guard needs directories that actually exist), and whichever use-case files the
 * case under test writes.
 */
function fleet(usecases: Record<string, string>, capabilities?: string): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    ...(capabilities === undefined ? {} : { "architecture/capabilities.yaml": capabilities }),
    "services/checkout-web/spec.md": spec("checkout-web"),
    "services/payment-service/spec.md": spec("payment-service"),
    "services/order-service/spec.md": spec("order-service"),
    "services/search-service/spec.md": spec("search-service"),
    ...usecases,
  };
}

/** A `views { }` file holding one dynamic view, tagged or not. */
function usecase(id: string, tag: string | null, steps: string): string {
  return `views {\n  dynamic view ${id} {\n${tag === null ? "" : `    #${tag}\n`}${steps}  }\n}\n`;
}

describe("the capability tag is the opt-in, and nothing else is", () => {
  it("never grades an untagged dynamic view, and grades the same view once it is tagged", async () => {
    // `payments -> web` is declared nowhere — the hop this whole axis exists to
    // convict. Untagged it must stay invisible: an untagged dynamic view is
    // somebody's hand-drawn diagram, and grading it would turn every fleet that
    // already has diagrams red on upgrade.
    const steps = "    payments -> web 'a hand-drawn hop nothing declares'\n";
    const p = await makeProject(fleet({ "architecture/usecases/hand.likec4": usecase("uc_hand", null, steps) }));
    try {
      const untagged = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(useCaseFindings(untagged.stdout)).toEqual([]);

      // The same view, the same hop, one tag added. Nothing else about the
      // repository changed, so the tag is provably the whole opt-in.
      await p.write("architecture/usecases/hand.likec4", usecase("uc_hand", "cap-checkout", steps));
      const tagged = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(codeFor(tagged.stdout, "usecase.step-unbacked")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("usecase.step-unbacked — the hop no other tool reports", () => {
  it("names the file, the step and both fixes, and the reply fix it offers actually clears it", async () => {
    const drawnForward = "    web -> payments 'authorizes the payment'\n    payments -> web 'confirms the authorization'\n";
    const p = await makeProject(
      fleet({ "architecture/usecases/checkout.likec4": usecase("uc_checkout", "cap-checkout", drawnForward) }, CAPABILITIES),
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const [unbacked, ...rest] = codeFor(res.stdout, "usecase.step-unbacked");
      // Step 1 is backed by the declared `web -> payments` edge, so exactly one
      // hop is convicted — a check that graded the call as well would be
      // reporting the model it was just handed.
      expect(rest).toEqual([]);
      expect(unbacked?.severity).toBe("error");
      expect(unbacked?.subject).toBe("uc_checkout");

      // The file the view was WRITTEN in, never the landscape: a message
      // pointing at the map sends its reader to a document that does not
      // contain the view.
      expect(unbacked?.message).toContain("architecture/usecases/checkout.likec4");
      expect(unbacked?.message).not.toContain("architecture/landscape.likec4");
      // The ordinal and title are what locate the arrow on the diagram.
      expect(unbacked?.message).toContain("step 2 'confirms the authorization'");
      // The ORIENTED pair, and both fixes.
      expect(unbacked?.message).toContain("nothing in the model declares payments -> web");
      expect(unbacked?.message).toContain("Draw the edge in `model { }`");
      expect(unbacked?.message).toContain("write it as `web <- payments`");

      // The suggestion is not decoration: written as the reply it says, the hop
      // is attributed to the call it answers and the finding is gone. A fix
      // instruction that did not fix it would be worse than none.
      await p.write(
        "architecture/usecases/checkout.likec4",
        usecase(
          "uc_checkout",
          "cap-checkout",
          "    web -> payments 'authorizes the payment'\n    web <- payments 'confirms the authorization'\n",
        ),
      );
      const fixed = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(useCaseFindings(fixed.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("usecase.step-contested — and the one finding it suppresses", () => {
  it("lists every candidate, and does not also report the candidate that carries no op", async () => {
    // `web -> orders` matches nothing exactly; the service tier finds the two
    // container edges, one naming createOrder and one naming nothing. An absent
    // op is a VALUE there, so the two disagree.
    const p = await makeProject(
      fleet({
        "architecture/usecases/order.likec4": usecase("uc_order", "cap-checkout", "    web -> orders 'places the order'\n"),
      }),
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const [contested] = codeFor(res.stdout, "usecase.step-contested");
      expect(contested?.severity).toBe("warn");
      expect(contested?.message).toContain("architecture/usecases/order.likec4");
      expect(contested?.message).toContain("step 1 'places the order'");
      expect(contested?.message).toContain("2 relationships back web -> orders");
      // The repair is made on a RELATIONSHIP, so the details name the edges
      // rather than the operations — a list of op names does not say which edge
      // to open.
      expect(contested?.details).toEqual([
        'web -> orders.api "Places the order" (op: createOrder)',
        'web -> orders.worker "Enqueues the order" (no op)',
      ]);

      // One breach, one finding. `web -> orders.worker` carries no op and no
      // message, and order-service is a real directory — every ingredient of
      // `usecase.step-unlinked` — but the hop already has its verdict.
      expect(codeFor(res.stdout, "usecase.step-unlinked")).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("usecase.step-unlinked — and the three guards that keep it honest", () => {
  it("warns on a hop into a real service that names no operation, naming the provider", async () => {
    const p = await makeProject(
      fleet({
        "architecture/usecases/notify.likec4": usecase(
          "uc_notify",
          "cap-checkout",
          "    payments -> orders 'notifies the order service'\n",
        ),
      }),
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const [unlinked, ...rest] = codeFor(res.stdout, "usecase.step-unlinked");
      expect(rest).toEqual([]);
      expect(unlinked?.severity).toBe("warn");
      expect(unlinked?.message).toContain("architecture/usecases/notify.likec4");
      expect(unlinked?.message).toContain("payments -> orders is backed by one relationship");
      // The PROVIDER, resolved through the shared element→service join — the
      // proof that the guard ran rather than that the element id happened to
      // look like a directory.
      expect(unlinked?.message).toContain("no operation of order-service's contract");
      expect(unlinked?.message).toContain("`metadata { op '<operationId>' }`");
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("stays silent on a datastore, an #external system and an edge that carries a message", async () => {
    // Three hops, all backed, all carrying no `metadata { op }`. Without the
    // provider-must-exist guard the first two warn — and neither a database nor
    // somebody else's payment processor owns an openapi.yaml that could carry
    // the operationId the message would be asking for. Without the
    // publishes/consumes exemption the third warns, which is loam demanding an
    // HTTP operation for an event.
    const p = await makeProject(
      fleet({
        "architecture/usecases/side.likec4": usecase(
          "uc_side",
          "cap-checkout",
          "    orders -> ledger 'writes the ledger entry'\n" +
            "    web -> stripe 'charges the card'\n" +
            "    orders -> payments 'reads the refund event'\n",
        ),
      }),
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(useCaseFindings(res.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("stays silent on the actor hop that opens almost every flow", async () => {
    // A person is not a caller. `customer -> web 'Uses'` is somebody using the
    // app, and checkout-web owes no operationId for a click — but the target IS
    // one of ours, so the provider-must-exist guard does not reach this and the
    // warning fired on the FIRST HOP of almost every sequence diagram. Measured
    // on the published example fleet before the guard existed.
    //
    // The second hop is the control: same view, same missing `op`, a service
    // calling a service — that one MUST still warn, or the fix has silenced the
    // check rather than corrected it.
    const p = await makeProject(
      fleet({
        "architecture/usecases/entry.likec4": usecase(
          "uc_entry",
          "cap-checkout",
          "    customer -> web 'opens the basket'\n" +
            "    payments -> orders 'notifies the order'\n",
        ),
      }),
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const unlinked = codeFor(res.stdout, "usecase.step-unlinked");
      expect(unlinked).toHaveLength(1);
      expect(unlinked[0]!.message).toContain("payments -> orders");
      expect(unlinked[0]!.message).not.toContain("customer");
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("usecase.capability-unresolved — the tag that names nothing, or two things", () => {
  it("offers close ids already spelled as the tag to write, and refuses to guess between colliding ones", async () => {
    const p = await makeProject(
      fleet(
        {
          "architecture/usecases/typo.likec4": usecase("uc_typo", "cap-checkot", "    web -> payments 'authorizes'\n"),
          "architecture/usecases/none.likec4": usecase("uc_none", "cap-nothing", "    web -> payments 'authorizes'\n"),
        },
        CAPABILITIES,
      ),
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const findings = codeFor(res.stdout, "usecase.capability-unresolved");
      expect(findings.map((f) => f.subject)).toEqual(["uc_none", "uc_typo"]);
      expect(findings.every((f) => f.severity === "error")).toBe(true);

      const typo = findings.find((f) => f.subject === "uc_typo");
      expect(typo?.message).toContain("architecture/usecases/typo.likec4");
      expect(typo?.message).toContain("is tagged #cap-checkot");
      // The id AND the tag: handed only `identity/tokens` an author writes
      // `#cap-identity/tokens`, which LikeC4 refuses to parse.
      expect(typo?.message).toContain("Did you mean: checkout (#cap-checkout)?");

      // Nothing close: the vocabulary is where the fix goes, and the flattening
      // rule is stated so the next tag is derivable.
      const none = findings.find((f) => f.subject === "uc_none");
      expect(none?.message).toContain("Declare it there (`capabilities: {<id>: {description, owner}}`)");
      expect(none?.message).toContain("A tag spells the id with every `/` flattened to `-`");
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("names EVERY colliding id when two declared capabilities flatten to one tag", async () => {
    // `payments/refunds` and `payments-refunds` are two legal, distinct,
    // declarable ids and one tag. Picking either silently would file a whole
    // business flow under an owner who never claimed it.
    const p = await makeProject(
      fleet(
        {
          "architecture/usecases/refunds.likec4": usecase(
            "uc_refunds",
            "cap-payments-refunds",
            "    web -> payments 'refunds the payment'\n",
          ),
        },
        COLLIDING,
      ),
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const [many] = codeFor(res.stdout, "usecase.capability-unresolved");
      expect(many?.severity).toBe("error");
      expect(many?.message).toContain("2 declared capabilities flatten to 'payments-refunds'");
      expect(many?.message).toContain("payments-refunds, payments/refunds");
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("the shapes an ordinary diagram produces", () => {
  it("handles an untitled reply hop, an untitled candidate edge, and a hop backed by more than one relationship", async () => {
    // Two views in ONE file, which is the shape an ordinary usecases document
    // has. It does NOT pin the row ordering and never did: `uc_index` and
    // `uc_reply` are already declared in sorted order, so these rows come out
    // identical whether `gradedViews` sorts or not. The describe below is the
    // case that discriminates that.
    const p = await makeProject(
      fleet({
        "architecture/usecases/search.likec4": `views {
  dynamic view uc_index {
    #cap-checkout
    web -> search 'searches the index'
    payments -> search 'indexes the payment'
  }
  dynamic view uc_reply {
    #cap-checkout
    payments <- web
  }
}
`,
      }),
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const findings = useCaseFindings(res.stdout);
      expect(findings.map((f) => `${f.subject}:${f.code}`)).toEqual([
        "uc_index:usecase.step-contested",
        "uc_index:usecase.step-unlinked",
        "uc_reply:usecase.step-unbacked",
      ]);

      // An untitled relationship is a candidate like any other, and it prints
      // with empty quotes rather than the word `undefined`.
      expect(findings[0]?.details).toEqual([
        'web -> search.primary "Queries the index" (op: searchOrders)',
        'web -> search.replica "" (no op)',
      ]);
      // Two container edges, one call: the message counts what it found rather
      // than asserting a single backing relationship it does not have.
      expect(findings[1]?.message).toContain("payments -> search is backed by 2 relationships");

      // An untitled hop is located by its ordinal alone — and it is a REPLY, so
      // the fix offered is the forward spelling. Suggesting `<-` to somebody who
      // already wrote `<-` would be a hint that restates the defect.
      expect(findings[2]?.message).toContain("dynamic view 'uc_reply' step 1:");
      expect(findings[2]?.message).toContain("if this hop is not a return step, write it as `web -> payments`");
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("the report's row order is loam's, not the parser's", () => {
  it("orders views by (file, view id) even where the declaration order says otherwise", async () => {
    // `gradedViews` sorts so that a report's row order cannot reorder under a
    // dependency bump — nothing in loam has measured that LikeC4 preserves
    // declaration order, and a diff that churns on a version bump is the failure
    // that sort is against. Until this case existed, replacing the sort with a
    // no-op left the whole file green: every other multi-view fixture happens to
    // declare its views already sorted.
    //
    // So both halves of the comparison are handed input that disagrees with the
    // answer. `z.likec4` declares `uc_zulu` BEFORE `uc_alpha`, and LikeC4 hands a
    // file's views back in declaration order (measured), so an unsorted report
    // leads with zulu. `uc_mike` sits in the OTHER file with an id between the
    // two, so a sort on the view id alone — the file half dropped — would
    // interleave it between them rather than lead with it.
    //
    // The file half is a contract statement rather than a discriminator, and
    // saying so is the honest framing: `architectureDocuments` sorts paths before
    // staging, so `a.likec4`'s views arrive first however this sorts. Writing
    // `z.likec4` into the fixture first is what records that the report does not
    // depend on that staging order remaining sorted.
    const p = await makeProject(
      fleet({
        "architecture/usecases/z.likec4": `views {
  dynamic view uc_zulu {
    #cap-checkout
    payments -> web 'declared first, reported last'
  }
  dynamic view uc_alpha {
    #cap-checkout
    payments -> web 'declared second, reported second'
  }
}
`,
        "architecture/usecases/a.likec4": usecase(
          "uc_mike",
          "cap-checkout",
          "    payments -> web 'written second, reported first'\n",
        ),
      }),
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      // One finding per view — `payments -> web` is declared nowhere, so every
      // view earns exactly one `step-unbacked` — which makes the subjects the
      // row order itself rather than a proxy for it.
      expect(useCaseFindings(res.stdout).map((f) => `${f.code}:${f.subject}`)).toEqual([
        "usecase.step-unbacked:uc_mike",
        "usecase.step-unbacked:uc_alpha",
        "usecase.step-unbacked:uc_zulu",
      ]);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("the capability vocabulary's ladder reaches the tag grade, and stops there", () => {
  it("suspends the tag grade while capabilities.yaml is absent or invalid, and never suspends the step grades", async () => {
    // The FILE is the capability axis's opt-in. A fleet that has not adopted the
    // vocabulary must still be able to have its use cases checked — coupling
    // the two would invert the adoption order the axis is built on.
    const steps = "    payments -> web 'a hop nothing declares'\n";
    const p = await makeProject(fleet({ "architecture/usecases/flow.likec4": usecase("uc_flow", "cap-checkout", steps) }));
    try {
      const absent = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(codeFor(absent.stdout, "usecase.capability-unresolved")).toEqual([]);
      // The hop is graded regardless: the tag is the opt-in, the vocabulary is
      // not.
      expect(codeFor(absent.stdout, "usecase.step-unbacked")).toHaveLength(1);

      // Unreadable is the same silence, and for the stronger reason: grading
      // every tag in the fleet against a file nobody can read is a cascade, not
      // a diagnosis. `capability.invalid` is the one finding that run owes.
      await p.write("architecture/capabilities.yaml", "capabilities:\n  - checkout\n  - identity\n");
      const invalid = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(codeFor(invalid.stdout, "usecase.capability-unresolved")).toEqual([]);
      const codes = (JSON.parse(invalid.stdout) as { targets: Array<{ findings: JsonFinding[] }> }).targets
        .flatMap((t) => t.findings)
        .map((f) => f.code);
      expect(codes).toContain("capability.invalid");
      expect(codeFor(invalid.stdout, "usecase.step-unbacked")).toHaveLength(1);

      // And once the vocabulary reads, the same tag is graded against it.
      await p.write("architecture/capabilities.yaml", "capabilities:\n  identity/tokens:\n    owner: platform\n");
      const present = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(codeFor(present.stdout, "usecase.capability-unresolved")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 90_000);
});
