/**
 * Smoke parity between the TWO readers of the same LikeC4 grammar living in
 * src/core/c4/likec4.ts: the semantic layer (loadSource — Langium parses and
 * computes the model) and the text layer (scanModel/maskSource — the splice
 * map `loam archive` merges the landscape with).
 *
 * The two are maintained independently, so any drift between them is a silent
 * merge corruption: scanModel would splice bytes at spans that stand for
 * different declarations than the parsed model reports, and nothing downstream
 * would notice until a landscape stops parsing (or worse, parses into the
 * wrong picture). This file pins the invariant on one deliberately rich
 * source — nested elements, both declaration forms, tags, metadata
 * service/op, quotes-inside-strings, and `model {` decoys in comments — the
 * exact patterns the individual unit tests exercise one at a time.
 *
 * The one divergence the layers are ALLOWED to have (escape sequences beyond
 * \' and \") is pinned in its own describe block below, not fixed: the merge
 * only ever writes escaped quotes, so the drift is harmless today, and the
 * pin is what tells us when that stops being true.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadSource, type LoadedDoc } from "../src/core/c4/likec4.js";
import { maskSource } from "../src/core/c4/source-mask.js";
import { scanModel, type ScannedModel } from "../src/core/c4/source-scan.js";

/**
 * One source that stresses everything the scanner claims to read like the
 * parser does: two `model {` decoys in comments, an element title with double
 * quotes inside single quotes, a description with an apostrophe inside double
 * quotes, metadata { service } / { op }, both declaration forms (`name = kind`
 * and `kind name`), three nesting levels, a sourceless `-> x` edge, a `//`
 * inside a string, an untitled edge, and a `title` property in an edge body.
 */
const RICH = `// fleet landscape: the model { of everything } drawn as C4
specification {
  element system
  element container
  element component
  tag FEAT-9
  tag external
}

/* Overview: the model { payments, billing } — a decoy the text scan must skip. */
model {
  customer = system 'Customer "Retail" portal' {
    #external
    description "the customer's entry point"
  }
  payments = system 'Payments API' {
    metadata { service 'payment-service' }
    api = container 'api' {
      technology 'Spring Boot'
      handler = component 'split handler'
      -> billing.core 'Charges' { metadata { op 'chargeInvoice' } }
    }
    db = container 'db'
    api -> db 'reads // not a comment'
  }
  billing = system 'Billing' {
    container core
  }
  bare = system 'Bare'
  customer -> payments.api 'Uses checkout' {
    #FEAT-9
    metadata { op 'createSplit' }
  }
  payments -> bare
  billing -> payments {
    title 'Settles'
  }
}

views {
  view index { include * }
}
`;

/**
 * Title of a scanned element, read the way the merge would have to: the first
 * string literal inside the declaration's head (before its `{`, if any); the
 * local name when there is none — LikeC4's own default for the `kind name`
 * form, so the fallback is part of the parity claim, not a fudge.
 */
function scannedTitles(src: string, scan: ScannedModel): Array<[string, string]> {
  const { literals } = maskSource(src);
  return scan.elements.map((el) => {
    const headEnd = el.bodyOpen === -1 ? el.end : el.bodyOpen;
    const lit = literals.find((l) => l.start >= el.start && l.end <= headEnd);
    return [el.id, lit?.value ?? el.id.slice(el.id.lastIndexOf(".") + 1)];
  });
}

/** Order-free identity of an edge: everything both layers claim to extract. */
function relKey(r: { source: string; target: string; title?: string; op?: string; tags: string[] }): string {
  return JSON.stringify([r.source, r.target, r.title ?? null, r.op ?? null, [...r.tags].sort()]);
}

describe("scanModel matches loadSource on one rich source (the merge's splice map vs the parsed truth)", () => {
  let doc: LoadedDoc;
  let scan: ScannedModel;
  beforeAll(async () => {
    doc = await loadSource(RICH);
    scan = scanModel(RICH)!;
  });

  it("the fixture is valid AND rich enough that parity cannot pass vacuously", () => {
    // A broken fixture would make every set-comparison below [] === [] — green
    // while proving nothing. Pin the floor of what the source must contain.
    expect(doc.errors).toEqual([]);
    expect(scan).not.toBeNull();
    expect(doc.elements.length).toBeGreaterThanOrEqual(8);
    expect(doc.relationships.length).toBeGreaterThanOrEqual(5);
  });

  it("both layers see the same element set, id AND title (titles read from the scanned head bytes)", () => {
    const parsed = doc.elements.map((e): [string, string] => [e.id, e.title]).sort();
    const scanned = scannedTitles(RICH, scan).sort();
    expect(scanned).toEqual(parsed);
  });

  it("both layers see the same edges: source/target/title/op/tags tuples match as sets", () => {
    const parsed = doc.relationships.map(relKey).sort();
    const scanned = scan.rels.map(relKey).sort();
    expect(scanned).toEqual(parsed);
  });

  it("negative control: the comparison DOES catch drift — a source only one layer misreads would fail it", () => {
    // Drop one parsed edge and re-compare: the assertion style above must go
    // red on any asymmetry, or the whole file is theater.
    const parsed = doc.relationships.slice(1).map(relKey).sort();
    const scanned = scan.rels.map(relKey).sort();
    expect(scanned).not.toEqual(parsed);
  });
});

describe("KNOWN divergence: escape sequences beyond \\' and \\\"", () => {
  // maskSource unescapes `\x` to bare `x` for EVERY x, while Langium interprets
  // recognised sequences (`\t`, `\n`, ...) as their control characters. Harmless
  // today — the merge only ever WRITES escaped quotes, which both layers read
  // identically (pinned below) — so this block pins the divergence instead of
  // fixing it: if either layer changes its reading, one of these goes red and
  // the drift becomes a decision instead of an accident.
  it("KNOWN: '\\t' in a title is a real TAB to the parser but a bare 't' to the scanner", async () => {
    const src = `specification { element system }
model {
  x = system 'left \\t right'
}
`;
    const doc = await loadSource(src);
    expect(doc.errors).toEqual([]);
    expect(doc.elements[0]!.title).toBe("left \t right");
    const lit = maskSource(src).literals[0]!;
    expect(lit.value).toBe("left t right");
    // the pin itself: the layers disagree here, by design of the pin (not of the code)
    expect(lit.value).not.toBe(doc.elements[0]!.title);
  });

  it("escaped quotes — the only escapes the merge writes — are read identically by both layers", async () => {
    const src = `specification { element system }
model {
  q = system 'quote \\' here'
  d = system "dquote \\" here"
}
`;
    const doc = await loadSource(src);
    expect(doc.errors).toEqual([]);
    const { literals } = maskSource(src);
    expect(literals.map((l) => l.value)).toEqual(["quote ' here", 'dquote " here']);
    expect(doc.elements.map((e) => e.title)).toEqual(["quote ' here", 'dquote " here']);
  });
});
