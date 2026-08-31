import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { OpenapiMergeError } from "../src/core/openapi/merge/error.js";
import { stripOpenapiRemovalMarkers } from "../src/core/openapi/merge/markers.js";
import { mergeOpenapiPaths } from "../src/core/openapi/merge/merge.js";
import { collectRefs, resolvePointer } from "../src/core/openapi/merge/components.js";

const LIVING = `# keep this comment
openapi: 3.1.0
info: { title: pets, version: "1" }
paths:
  /pets:
    post:
      operationId: createPet
      summary: old summary
      responses: {}
components:
  schemas:
    Pet:
      type: object
      properties:
        legacy: { type: boolean }
`;

describe("mergeOpenapiPaths", () => {
  it("overwrites an existing operation and reports it by operationId", () => {
    const feature = `openapi: 3.1.0
paths:
  /pets:
    post:
      operationId: createPet
      summary: new summary
      responses: {}
`;

    const result = mergeOpenapiPaths(LIVING, feature, "pets");

    expect(result.modified).toEqual(["'createPet' (post /pets)"]);
    expect(result.componentsModified).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.text).not.toBeNull();
    expect(result.text).toContain("# keep this comment");
    expect(parse(result.text!).paths["/pets"].post.summary).toBe("new summary");
  });

  it("copies a recursive component closure and reports a differing living component", () => {
    const feature = `openapi: 3.1.0
paths:
  /pets/{id}:
    get:
      operationId: getPet
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
components:
  schemas:
    Pet:
      type: object
      properties:
        owner: { $ref: '#/components/schemas/Owner' }
    Owner:
      type: object
      properties:
        name: { type: string }
    Unused: { type: string }
`;

    const result = mergeOpenapiPaths(LIVING, feature, "pets");
    const merged = parse(result.text!);

    expect(result.componentsModified).toEqual(["schemas/Pet"]);
    expect(merged.components.schemas.Pet.properties.owner.$ref).toBe("#/components/schemas/Owner");
    expect(merged.components.schemas.Owner).toBeDefined();
    expect(merged.components.schemas.Unused).toBeUndefined();
  });

  it("resolves anchored operation and component aliases with document context", () => {
    const feature = `openapi: 3.1.0
x-get-pet: &getPet
  operationId: getPet
  responses:
    "200":
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Pet' }
paths:
  /pets/{id}:
    get: *getPet
components:
  schemas:
    PetShape: &petShape
      type: object
      properties:
        id: { type: string }
    Pet: *petShape
`;

    const result = mergeOpenapiPaths(LIVING, feature, "pets");
    const merged = parse(result.text!);

    expect(merged.paths["/pets/{id}"].get.operationId).toBe("getPet");
    expect(merged.paths["/pets/{id}"].get.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/Pet");
    expect(merged.components.schemas.Pet.properties.id).toEqual({ type: "string" });
    expect(result.unresolved).toEqual([]);
  });

  it("reports unresolved local refs with their source and ignores external refs", () => {
    const feature = `openapi: 3.1.0
paths:
  /pets/{id}:
    get:
      operationId: getPet
      parameters:
        - { $ref: '#/components/parameters/Missing' }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: 'https://example.test/pet.json#/Pet' }
`;

    const result = mergeOpenapiPaths(LIVING, feature, "pets");

    expect(result.unresolved).toEqual([
      { ref: "#/components/parameters/Missing", from: "paths /pets/{id}" },
    ]);
  });

  it("returns a no-op result when the feature restates neither a path nor a component", () => {
    // `components: {}` declares nothing, so there is genuinely nothing to
    // merge. The absence of `paths` alone is NOT that answer any more — see
    // the components-only tests below, where it used to be.
    expect(mergeOpenapiPaths(LIVING, "openapi: 3.1.0\ncomponents: {}\n", "pets")).toEqual({
      text: null,
      modified: [],
      pathItemModified: [],
      removed: [],
      quoted: [],
      baselineStale: [],
      pathItemQuoted: [],
      pathItemStale: [],
      componentsModified: [],
      componentsAdded: [],
      componentsQuoted: [],
      componentsStale: [],
      unresolved: [],
    });
  });

  it("merges a components-only delta — no `paths` key at all — instead of dropping it", () => {
    // THE DEFECT. A feature whose whole change is a shared schema is a legal
    // and ordinary contract delta, and the merge answered "no paths, nothing to
    // do" before it had even parsed the living document — so archive exited 0
    // having written nothing, and the schema every consumer was told to expect
    // was simply not there.
    const feature = `openapi: 3.1.0
components:
  schemas:
    Split: { type: object, properties: { share: { type: number } } }
`;

    const result = mergeOpenapiPaths(LIVING, feature, "pets");

    expect(result.text).not.toBeNull();
    expect(parse(result.text!).components.schemas.Split).toEqual({
      type: "object",
      properties: { share: { type: "number" } },
    });
    expect(result.componentsAdded).toEqual(["schemas/Split"]);
    expect(result.componentsModified).toEqual([]);
    // The living contract's own components are untouched by a delta that never
    // mentions them.
    expect(parse(result.text!).components.schemas.Pet.properties.legacy).toEqual({ type: "boolean" });
  });

  it("sweeps a components-only delta's own refs, so a dangling one still gates", () => {
    // The proof the CLOSURE ran rather than a copy shortcut: promoting the
    // parked components has to happen before the ref fixpoint is seeded, or a
    // promoted schema carries its own `$ref`s past the sweep and archive
    // publishes a living contract pointing at a component nobody wrote. The
    // `from` label is how the queue names a copy: `components/<kind>/<name>`.
    const feature = `openapi: 3.1.0
components:
  schemas:
    Split:
      type: object
      properties:
        amount: { $ref: '#/components/schemas/Money' }
`;

    const result = mergeOpenapiPaths(LIVING, feature, "pets");

    expect(result.unresolved).toEqual([
      { ref: "#/components/schemas/Money", from: "components/schemas/Split" },
    ]);
  });

  it("grows a `components` section on a living contract that had none", () => {
    // The components twin of the appended `paths:` block: `setComponentValue`
    // falls through to `setIn`, which has to create both levels, and the result
    // still has to parse.
    const noComponents = `openapi: 3.1.0
info: { title: pets, version: "1" }
paths:
  /pets:
    post:
      operationId: createPet
      responses: {}
`;
    const feature = `openapi: 3.1.0
components:
  schemas:
    Split: { type: object }
`;

    const result = mergeOpenapiPaths(noComponents, feature, "pets");
    const merged = parse(result.text!);

    expect(result.componentsAdded).toEqual(["schemas/Split"]);
    expect(merged.components.schemas.Split).toEqual({ type: "object" });
    expect(merged.paths["/pets"].post.operationId, "the paths it already had survive").toBe("createPet");
  });

  it("never publishes a feature-only key nested inside a promoted component", () => {
    // The promotion goes through the same `withoutFeatureKeysDeep` write as
    // every other copy. A components-only delta must not become the one shape
    // that publishes loam's bookkeeping into a living contract — the failure
    // `--approve` already caused once, from a component holding an operation
    // shape.
    const feature = `openapi: 3.1.0
components:
  schemas:
    Split:
      type: object
      properties:
        share:
          type: number
          x-loam-remove: true
`;

    const result = mergeOpenapiPaths(LIVING, feature, "pets");

    expect(result.text).not.toContain("x-loam-remove");
    expect(parse(result.text!).components.schemas.Split.properties.share).toEqual({ type: "number" });
  });

  it("still leaves an unreachable NEW component behind when the delta DOES merge paths", () => {
    // The scope guard on the promotion. One path entry means the reachability
    // question is a real one — the delta has written content for a new
    // component to be reachable FROM — so `Orphan` stays behind exactly as the
    // `Unused` case above pins it. A promotion flag wide enough to catch this
    // document is a flag that would drag a quoted operation's authoring-time
    // component over somebody else's landed change.
    const feature = `openapi: 3.1.0
paths:
  /pets/{id}:
    get:
      operationId: getPet
      responses: {}
components:
  schemas:
    Orphan: { type: object, title: "new, and referenced by nothing" }
`;

    const result = mergeOpenapiPaths(LIVING, feature, "pets");

    expect(parse(result.text!).components.schemas.Orphan).toBeUndefined();
    expect(result.componentsAdded).toEqual([]);
  });

  it("removes only the exact living path+method target and never persists the marker", () => {
    const feature = `openapi: 3.1.0
paths:
  /pets:
    post:
      operationId: createPet
      x-loam-remove: true
`;

    const result = mergeOpenapiPaths(LIVING, feature, "pets");
    const merged = parse(result.text!);

    expect(result.removed).toEqual(["'createPet' (post /pets)"]);
    // The last method gone takes the path with it: `/pets: {}` is a path the
    // contract still advertises and nothing answers.
    expect(merged.paths["/pets"]).toBeUndefined();
    expect(result.text).not.toContain("x-loam-remove");
    // Removal is deliberately not component GC: stale components are safe and
    // may still be referenced elsewhere in the contract.
    expect(merged.components.schemas.Pet).toBeDefined();
  });

  it("does not delete a different living operation under an approved mismatched marker", () => {
    const feature = `paths:
  /pets:
    post:
      operationId: deletePet
      x-loam-remove: true
`;
    const result = mergeOpenapiPaths(LIVING, feature, "pets");
    const merged = parse(result.text!);

    expect(result.removed).toEqual([]);
    expect(merged.paths["/pets"].post.operationId).toBe("createPet");
    expect(result.text).not.toContain("x-loam-remove");
  });

  it("strips removal-only paths before an approved create can become living", () => {
    const feature = `openapi: 3.1.0
info: { title: new-service, version: "1" }
paths:
  /ghost:
    post:
      operationId: ghostOp
      x-loam-remove: true
`;
    const text = stripOpenapiRemovalMarkers(feature, "new-service");
    const cleaned = parse(text);

    expect(text).not.toContain("x-loam-remove");
    expect(cleaned.paths["/ghost"]).toBeUndefined();
  });

  it("keeps the author's comments and anchors when another method is a plain scalar", () => {
    // The strip has to run — `/ghost` carries a marker — and the document also
    // spells a method as a scalar. Demanding that every method be a map node
    // sent this whole document down the rewrite-from-the-resolved-tree branch,
    // and these are the bytes archive installs as the living contract: the
    // comment, the anchor and `~` all died for a node the in-place branch would
    // never have touched, since a scalar is neither a removal marker nor a pin.
    const feature = `openapi: 3.1.0
info: { title: new-service, version: "1" }
x-ok: &ok { "200": { description: ok } }
paths:
  /ghost:
    post:
      operationId: ghostOp
      x-loam-remove: true
  /health:
    # liveness only — readiness lives on the mesh sidecar
    get: ~
    post:
      operationId: ping
      x-loam-based-on: deadbeef
      responses: *ok
`;

    const text = stripOpenapiRemovalMarkers(feature, "new-service");
    const cleaned = parse(text);

    expect(text).toContain("# liveness only — readiness lives on the mesh sidecar");
    expect(text).toContain("get: ~");
    expect(text).toContain("responses: *ok");
    // Everything the strip owes the living contract still happened.
    expect(text).not.toContain("x-loam-remove");
    expect(text).not.toContain("x-loam-based-on");
    expect(cleaned.paths["/ghost"]).toBeUndefined();
    expect(cleaned.paths["/health"].get).toBeNull();
    expect(cleaned.paths["/health"].post.responses["200"].description).toBe("ok");
  });

  it("falls back to the resolved tree when an operation is a YAML alias", () => {
    // An alias is the one node kind that resolves to a mapping without being a
    // map, so `deleteIn` walking to its pin threw out of archive as `internal`,
    // and there is no way to strip the pin off one use of an anchor and not the
    // rest. Losing the formatting is what not shipping the marker costs here.
    const feature = `openapi: 3.1.0
x-ping: &ping
  operationId: ping
  x-loam-based-on: deadbeef
  responses: {}
paths:
  /ghost:
    post:
      operationId: ghostOp
      x-loam-remove: true
  /health:
    get: *ping
`;

    const text = stripOpenapiRemovalMarkers(feature, "new-service");
    const cleaned = parse(text);

    // Expanded where the alias stood, which is the safe branch's signature.
    expect(text).not.toContain("get: *ping");
    expect(text).not.toContain("x-loam-remove");
    expect(cleaned.paths["/ghost"]).toBeUndefined();
    expect(cleaned.paths["/health"].get.operationId).toBe("ping");
    expect(cleaned.paths["/health"].get["x-loam-based-on"]).toBeUndefined();
  });

  it("falls back to the resolved tree when a method's own KEY is an alias", () => {
    // The degenerate form of the same question, pinned because the obvious
    // narrowing — refuse in-place editing for method nodes that are aliases —
    // passes this document as editable and then crashes on it: `deleteIn`
    // cannot find a key spelled as an alias, so it reports the node missing
    // exactly as it does for the aliased operation above. What the in-place
    // branch actually needs is to REACH every mapping it has to edit.
    const feature = `k: &getKey get
paths:
  /ghost:
    post:
      operationId: ghostOp
      x-loam-remove: true
  /health:
    *getKey : { operationId: ping, x-loam-based-on: deadbeef }
`;

    const text = stripOpenapiRemovalMarkers(feature, "new-service");
    const cleaned = parse(text);

    expect(text).not.toContain("x-loam-remove");
    expect(text).not.toContain("x-loam-based-on");
    expect(cleaned.paths["/ghost"]).toBeUndefined();
    expect(cleaned.paths["/health"].get.operationId).toBe("ping");
  });

  it("uses a typed error contract for an unreadable document", () => {
    expect(() => mergeOpenapiPaths(LIVING, "paths: [", "pets")).toThrowError(OpenapiMergeError);
    try {
      mergeOpenapiPaths(LIVING, "paths: [", "pets");
    } catch (error) {
      expect(error).toMatchObject({ source: "feature", service: "pets" });
      expect((error as Error).message).toContain("feature openapi for pets is not valid YAML");
    }
  });
});

describe("OpenAPI merge helpers", () => {
  it("collects refs in document order", () => {
    expect(collectRefs({ one: { $ref: "#/a" }, two: [{ $ref: "#/b" }] })).toEqual(["#/a", "#/b"]);
  });

  it("resolves escaped JSON pointer segments", () => {
    expect(resolvePointer({ "a/b": { "c~d": 42 } }, "#/a~1b/c~0d")).toEqual({ found: true, value: 42 });
  });
});
