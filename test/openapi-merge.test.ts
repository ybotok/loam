import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  OpenapiMergeError,
  collectRefs,
  mergeOpenapiPaths,
  resolvePointer,
  stripOpenapiRemovalMarkers,
} from "../src/core/openapi-merge.js";

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

  it("returns a no-op result when the feature has no paths", () => {
    expect(mergeOpenapiPaths(LIVING, "openapi: 3.1.0\ncomponents: {}\n", "pets")).toEqual({
      text: null,
      modified: [],
      pathItemModified: [],
      removed: [],
      quoted: [],
      baselineStale: [],
      componentsModified: [],
      unresolved: [],
    });
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
