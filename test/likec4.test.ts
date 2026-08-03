/**
 * Deep unit invariants for src/core/likec4.ts (loadFile).
 *
 * loadFile is the single door through which every command (validate, delta,
 * archive, coherence) sees a .likec4 document, so this file pins its contract:
 * the shape of ids (FQN for nested elements — archive writes them verbatim into
 * the landscape), the exact tag strings (WITHOUT '#' — coherence filters with
 * tags.includes('FEAT-1')), the op extraction from `metadata { op '...' }` (the
 * operationId spine), and the all-or-nothing error behavior on broken docs.
 */
import { describe, it, expect, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { loadFile, type LoadedDoc } from "../src/core/likec4.js";
import { makeTmpDir, writeFiles, LANDSCAPE, FEATURE_DELTA } from "./helpers/harness.js";

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Write `src` as a standalone doc.likec4 in a fresh tmp dir and loadFile it. */
async function load(src: string): Promise<LoadedDoc> {
  const dir = await makeTmpDir("likec4-unit-");
  tmpDirs.push(dir);
  await writeFiles(dir, { "doc.likec4": src });
  return loadFile(join(dir, "doc.likec4"));
}

const byId = (doc: LoadedDoc, id: string) => doc.elements.find((e) => e.id === id);

/* ------------------------------------------------------------------ */
/* Known-good harness fixtures                                         */
/* ------------------------------------------------------------------ */

describe("known-good fixtures load cleanly", () => {
  it("harness LANDSCAPE yields no errors and the exact element set (id/kind/title/description)", async () => {
    const doc = await load(LANDSCAPE);
    expect(doc.errors).toEqual([]);
    const sorted = [...doc.elements].sort((a, b) => a.id.localeCompare(b.id));
    expect(sorted).toEqual([
      { id: "checkoutWeb", kind: "softwareSystem", title: "checkout-web", description: "Customer-facing checkout UI", tags: [] },
      { id: "customer", kind: "person", title: "Customer", description: undefined, tags: [] },
      { id: "paymentService", kind: "softwareSystem", title: "payment-service", description: "Owns payment authorization/capture", tags: [] },
    ]);
  });

  it("harness LANDSCAPE yields both relationships, with op only on the metadata-linked edge", async () => {
    const doc = await load(LANDSCAPE);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships).toHaveLength(2);
    const uses = doc.relationships.find((r) => r.title === "Uses");
    expect(uses).toMatchObject({ source: "customer", target: "checkoutWeb", tags: [] });
    expect(uses?.op).toBeUndefined();
    const calls = doc.relationships.find((r) => r.title === "Calls authorizePayment");
    expect(calls).toMatchObject({
      source: "checkoutWeb",
      target: "paymentService",
      op: "authorizePayment",
      tags: [],
    });
  });

  it("harness FEATURE_DELTA yields no errors; the new service carries tag 'FEAT-1' and the context element carries none", async () => {
    const doc = await load(FEATURE_DELTA);
    expect(doc.errors).toEqual([]);
    expect(byId(doc, "paymentSplitService")).toEqual({
      id: "paymentSplitService",
      kind: "softwareSystem",
      title: "payment-split-service",
      description: "Splits a payment across payees",
      tags: ["FEAT-1"],
    });
    expect(byId(doc, "paymentService")?.tags).toEqual([]);
  });

  it("harness FEATURE_DELTA's edge carries op 'createSplit' and tag 'FEAT-1'", async () => {
    const doc = await load(FEATURE_DELTA);
    expect(doc.relationships).toEqual([
      {
        source: "paymentService",
        target: "paymentSplitService",
        title: "Calls createSplit",
        op: "createSplit",
        tags: ["FEAT-1"],
      },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Referential integrity                                               */
/* ------------------------------------------------------------------ */

describe("referential integrity", () => {
  it("every relationship's source and target id appears among the returned element ids (flat doc)", async () => {
    const doc = await load(FEATURE_DELTA);
    const ids = new Set(doc.elements.map((e) => e.id));
    for (const r of doc.relationships) {
      expect(ids).toContain(r.source);
      expect(ids).toContain(r.target);
    }
    expect(doc.relationships.length).toBeGreaterThan(0);
  });

  it("every relationship's source and target id appears among the returned element ids (nested containers)", async () => {
    const doc = await load(`specification {
  element softwareSystem
  element container
}
model {
  s = softwareSystem 'svc' {
    api = container 'api'
    db = container 'db'
    api -> db 'reads'
  }
  ext = softwareSystem 'ext'
  ext -> s 'Calls'
}
`);
    expect(doc.errors).toEqual([]);
    const ids = new Set(doc.elements.map((e) => e.id));
    expect(doc.relationships).toHaveLength(2);
    for (const r of doc.relationships) {
      expect(ids).toContain(r.source);
      expect(ids).toContain(r.target);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Tags — the feature-id spine (must be WITHOUT '#')                   */
/* ------------------------------------------------------------------ */

describe("tags surface without the '#' sigil (coherence/archive filter with tags.includes(featureId))", () => {
  it("element tag '#FEAT-1' in the body surfaces as exactly 'FEAT-1'", async () => {
    const doc = await load(`specification {
  element softwareSystem
  tag FEAT-1
}
model {
  a = softwareSystem 'A' { #FEAT-1 }
}
`);
    expect(doc.errors).toEqual([]);
    expect(byId(doc, "a")?.tags).toEqual(["FEAT-1"]);
  });

  it("relationship tag '#FEAT-1' (body with tag only, no metadata) surfaces as exactly 'FEAT-1' with op undefined", async () => {
    const doc = await load(`specification {
  element softwareSystem
  tag FEAT-1
}
model {
  a = softwareSystem 'A'
  b = softwareSystem 'B'
  a -> b 'Publishes Event' { #FEAT-1 }
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships).toHaveLength(1);
    expect(doc.relationships[0]!.tags).toEqual(["FEAT-1"]);
    expect(doc.relationships[0]!.op).toBeUndefined();
  });

  it("multiple tags on one element all surface, in declaration order, without '#'", async () => {
    const doc = await load(`specification {
  element softwareSystem
  tag FEAT-1
  tag deprecated
}
model {
  a = softwareSystem 'A' { #FEAT-1 #deprecated }
}
`);
    expect(doc.errors).toEqual([]);
    expect(byId(doc, "a")?.tags).toEqual(["FEAT-1", "deprecated"]);
  });

  it("an untagged child nested in a tagged parent does NOT inherit the feature tag (archive must not merge untagged children verbatim)", async () => {
    // If children inherited the parent's feature tag, archive's mergeIntoLandscape
    // would emit `parent.child = container ...` as a top-level model line — invalid LikeC4.
    const doc = await load(`specification {
  element softwareSystem
  element container
  tag FEAT-1
}
model {
  s = softwareSystem 'svc' {
    #FEAT-1
    api = container 'api'
  }
}
`);
    expect(doc.errors).toEqual([]);
    expect(byId(doc, "s")?.tags).toEqual(["FEAT-1"]);
    expect(byId(doc, "s.api")?.tags).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Nested elements — FQN ids                                           */
/* ------------------------------------------------------------------ */

describe("nested element ids are dotted FQNs (archive writes these ids verbatim)", () => {
  it("a container inside a softwareSystem comes back with id 'parent.child'", async () => {
    const doc = await load(`specification {
  element softwareSystem
  element container
}
model {
  paymentSplitService = softwareSystem 'payment-split-service' {
    api = container 'api' {
      technology 'Spring Boot'
    }
  }
}
`);
    expect(doc.errors).toEqual([]);
    const api = byId(doc, "paymentSplitService.api");
    expect(api).toBeDefined();
    expect(api).toMatchObject({ kind: "container", title: "api" });
    // and no bare 'api' id leaks out alongside the FQN
    expect(byId(doc, "api")).toBeUndefined();
  });

  it("two levels of nesting produce a two-dot FQN", async () => {
    const doc = await load(`specification {
  element softwareSystem
  element container
  element component
}
model {
  s = softwareSystem 'svc' {
    api = container 'api' {
      handler = component 'handler'
    }
  }
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.elements.map((e) => e.id).sort()).toEqual(["s", "s.api", "s.api.handler"]);
  });

  it("a relationship between nested containers reports FQN source/target ids", async () => {
    const doc = await load(`specification {
  element softwareSystem
  element container
}
model {
  s = softwareSystem 'svc' {
    api = container 'api'
    db = container 'db'
    api -> db 'reads'
  }
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships).toHaveLength(1);
    expect(doc.relationships[0]).toMatchObject({ source: "s.api", target: "s.db", title: "reads" });
  });
});

/* ------------------------------------------------------------------ */
/* metadata { op } — the operationId spine                             */
/* ------------------------------------------------------------------ */

describe("relationship op extraction from metadata", () => {
  it("metadata { op 'createSplit' } surfaces as rel.op === 'createSplit'", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A'
  b = softwareSystem 'B'
  a -> b 'Calls createSplit' { metadata { op 'createSplit' } }
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships[0]!.op).toBe("createSplit");
  });

  it("a relationship without metadata has op undefined", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A'
  b = softwareSystem 'B'
  a -> b 'Calls something'
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships[0]!.op).toBeUndefined();
  });

  it("metadata with other keys but no op yields op undefined", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A'
  b = softwareSystem 'B'
  a -> b 'Calls' { metadata { proto 'grpc' } }
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships[0]!.op).toBeUndefined();
  });

  it("op is extracted even when metadata carries additional keys", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A'
  b = softwareSystem 'B'
  a -> b 'Calls x' {
    metadata {
      op 'createSplit'
      proto 'grpc'
    }
  }
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships[0]!.op).toBe("createSplit");
  });

  it("two relationships between the same pair with different ops are both returned, each with its own op", async () => {
    const doc = await load(`specification {
  element softwareSystem
  tag FEAT-1
}
model {
  a = softwareSystem 'A'
  b = softwareSystem 'B'
  a -> b 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }
  a -> b 'Calls voidSplit' {
    #FEAT-1
    metadata { op 'voidSplit' }
  }
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships).toHaveLength(2);
    const ops = doc.relationships.map((r) => r.op).sort();
    expect(ops).toEqual(["createSplit", "voidSplit"]);
    // both edges keep their own title <-> op pairing
    for (const r of doc.relationships) {
      expect(r.title).toBe(`Calls ${r.op}`);
      expect(r.source).toBe("a");
      expect(r.target).toBe("b");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Descriptions                                                        */
/* ------------------------------------------------------------------ */

describe("description forms", () => {
  it("body-property string description surfaces as a plain string", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A' {
    description 'plain description'
  }
}
`);
    expect(doc.errors).toEqual([]);
    expect(byId(doc, "a")?.description).toBe("plain description");
  });

  it("second-positional-argument description surfaces as a plain string", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A' 'the description'
}
`);
    expect(doc.errors).toEqual([]);
    expect(byId(doc, "a")?.description).toBe("the description");
  });

  it("rich-text (triple-quoted markdown) description surfaces as a string, not an object", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A' {
    description '''
      # Heading
      Rich **markdown** description
    '''
  }
}
`);
    expect(doc.errors).toEqual([]);
    const desc = byId(doc, "a")?.description;
    expect(typeof desc).toBe("string");
    expect(desc).toContain("markdown description");
  });

  it("an element without a description surfaces description as undefined", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A'
}
`);
    expect(doc.errors).toEqual([]);
    expect(byId(doc, "a")?.description).toBeUndefined();
  });

  it("a title containing an escaped apostrophe round-trips unescaped", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'Customer\\'s portal'
}
`);
    expect(doc.errors).toEqual([]);
    expect(byId(doc, "a")?.title).toBe("Customer's portal");
  });
});

/* ------------------------------------------------------------------ */
/* Relationship title typing                                           */
/* ------------------------------------------------------------------ */

describe("relationship title", () => {
  it("a titled relationship surfaces its title string", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A'
  b = softwareSystem 'B'
  a -> b 'Uses'
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships[0]!.title).toBe("Uses");
  });

  it("a relationship without a title surfaces title as undefined (the declared Rel.title?: string contract — not null)", async () => {
    // Rel declares `title?: string`. Callers guard with `r.title ? ...` today, but a
    // strict consumer checking `r.title !== undefined` would let a non-string through.
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A'
  b = softwareSystem 'B'
  a -> b
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships).toHaveLength(1);
    expect(doc.relationships[0]!.title).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Broken docs — all-or-nothing                                        */
/* ------------------------------------------------------------------ */

describe("broken docs return errors and nothing else", () => {
  it("a syntax error yields non-empty errors with a message string, and empty elements/relationships", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A' {
`);
    expect(doc.errors.length).toBeGreaterThan(0);
    for (const e of doc.errors) {
      expect(typeof e.message).toBe("string");
      expect(e.message.length).toBeGreaterThan(0);
    }
    expect(doc.elements).toEqual([]);
    expect(doc.relationships).toEqual([]);
  });

  it("an unknown element kind is an error naming the kind, with empty results", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = wibble 'A'
}
`);
    expect(doc.errors.length).toBeGreaterThan(0);
    expect(doc.errors.map((e) => e.message).join("\n")).toContain("wibble");
    expect(doc.elements).toEqual([]);
    expect(doc.relationships).toEqual([]);
  });

  it("an undeclared tag is an error, with empty results (deltas must declare their feature tag)", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A' { #FEAT-9 }
}
`);
    expect(doc.errors.length).toBeGreaterThan(0);
    expect(doc.errors.map((e) => e.message).join("\n")).toContain("FEAT-9");
    expect(doc.elements).toEqual([]);
    expect(doc.relationships).toEqual([]);
  });

  it("a relationship to an undeclared id is an error, with empty results", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A'
  a -> ghost 'Calls'
}
`);
    expect(doc.errors.length).toBeGreaterThan(0);
    expect(doc.errors.map((e) => e.message).join("\n")).toContain("ghost");
    expect(doc.elements).toEqual([]);
    expect(doc.relationships).toEqual([]);
  });

  it("a duplicate element name is an error, with empty results (ids must be unambiguous for the merge)", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
  a = softwareSystem 'A'
  a = softwareSystem 'Also A'
}
`);
    expect(doc.errors.length).toBeGreaterThan(0);
    expect(doc.elements).toEqual([]);
    expect(doc.relationships).toEqual([]);
  });

  it("a valid doc with an empty model yields no errors and empty element/relationship lists", async () => {
    const doc = await load(`specification { element softwareSystem }
model {
}
`);
    expect(doc.errors).toEqual([]);
    expect(doc.elements).toEqual([]);
    expect(doc.relationships).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Missing file                                                        */
/* ------------------------------------------------------------------ */

describe("missing file", () => {
  it("loadFile rejects with ENOENT for a nonexistent path (callers existsSync-guard; a silent empty doc would mask misconfiguration)", async () => {
    const dir = await makeTmpDir("likec4-unit-");
    tmpDirs.push(dir);
    const missing = join(dir, "does-not-exist.likec4");
    await expect(loadFile(missing)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
