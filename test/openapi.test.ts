/**
 * Deep invariants for src/core/openapi.ts — operationIds() and serviceOperationIds().
 *
 * operationId is the spine joining the three axes (C4 edge `op` ↔ requirement
 * `Operations:` ↔ OpenAPI `operationId`, SCHEMA.md "API linkage"). Extraction must
 * therefore mirror YAML semantics exactly:
 *  - a dropped id fabricates E1/E2 "not defined in OpenAPI" coherence errors that
 *    gate `loam archive` (src/core/coherence.ts:62,78);
 *  - a phantom id (false positive) both fabricates "not governed" coverage warnings
 *    (src/commands/validate.ts:70-74) and MASKS genuine contract breaks, because a
 *    description merely mentioning an op makes it look "available".
 *
 * Decisions documented here (asserted as desired behavior):
 *  - charset: the OpenAPI spec allows ANY string for operationId; real-world ids use
 *    hyphens ('get-user') and dots ('users.list'). Extraction must return them.
 *  - duplicates: operationId MUST be unique per OpenAPI document, and the reader
 *    used to enforce that by keeping only the first slot claiming a name. That
 *    dedup hid the single most common contract edit: RELOCATING an endpoint is a
 *    removal marker at the old (path, method) and an upsert at the new one — the
 *    same operationId twice, on purpose — and whichever came second in document
 *    order vanished. So `ops` is keyed by SLOT, and an id genuinely repeated
 *    inside one document rides out as `duplicateIds` for a caller to grade
 *    (`openapi.duplicate-operationid`) instead of being silently halved.
 *  - strictness: only real `paths.*.<method>.operationId` keys count. Text inside
 *    block scalars / comments is not an operation. The `yaml` package is already a
 *    devDep, so a structurally correct extractor is cheap.
 */
import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { operationIds, operations, readOpenapi, serviceOperationIds } from "../src/core/openapi.js";
import {
  FEATURE_DELTA,
  FEATURE_OPENAPI,
  FEATURE_SPEC,
  LIVING_OPENAPI,
  coherentFixture,
  makeProject,
  makeTmpDir,
  runLoam,
  writeFiles,
} from "./helpers/harness.js";

/** Run `fn` against a throwaway dir populated with `files`; always clean up. */
async function withDir<T>(
  files: Record<string, string>,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  const root = await makeTmpDir();
  try {
    await writeFiles(root, files);
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** operationIds() of a single inline OpenAPI document. */
async function extract(content: string): Promise<string[]> {
  return withDir({ "openapi.yaml": content }, (root) => operationIds(join(root, "openapi.yaml")));
}

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** Ground truth: what a real YAML parse says the document's operationIds are. */
function yamlGroundTruth(text: string): string[] {
  const doc = parse(text) as { paths?: Record<string, unknown> } | null;
  const ids: string[] = [];
  for (const item of Object.values(doc?.paths ?? {})) {
    if (item === null || typeof item !== "object") continue;
    for (const [method, op] of Object.entries(item as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (op !== null && typeof op === "object") {
        const id = (op as { operationId?: unknown }).operationId;
        if (typeof id === "string") ids.push(id);
      }
    }
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* Basic extraction                                                    */
/* ------------------------------------------------------------------ */

describe("operationIds — basic extraction", () => {
  it("extracts the single operationId from the canonical living OpenAPI fixture", async () => {
    expect(await extract(LIVING_OPENAPI)).toEqual(["authorizePayment"]);
  });

  it("extracts every operationId across multiple paths and methods, in document order", async () => {
    const doc = `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /users:
    get:
      operationId: listUsers
      summary: List users
      responses:
        "200":
          description: OK
    post:
      operationId: createUser
      summary: Create a user
      responses:
        "201":
          description: Created
  /users/{id}:
    get:
      operationId: getUser
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: OK
    delete:
      operationId: deleteUser
      responses:
        "204":
          description: Deleted
`;
    expect(parse(doc)).toBeTruthy(); // fixture is valid YAML
    expect(await extract(doc)).toEqual(["listUsers", "createUser", "getUser", "deleteUser"]);
  });

  it("extracts a single-quoted operationId value", async () => {
    const doc = LIVING_OPENAPI.replace("operationId: authorizePayment", "operationId: 'authorizePayment'");
    expect(await extract(doc)).toEqual(["authorizePayment"]);
  });

  it("extracts a double-quoted operationId value", async () => {
    const doc = LIVING_OPENAPI.replace("operationId: authorizePayment", 'operationId: "authorizePayment"');
    expect(await extract(doc)).toEqual(["authorizePayment"]);
  });

  it("agrees with a real YAML parse on a realistic multi-operation document", async () => {
    const doc = `openapi: 3.1.0
info:
  title: payment-service
  version: "2.3"
paths:
  /payments:
    post:
      operationId: authorizePayment
      summary: Authorize a payment
      responses:
        "201":
          description: Authorized
  /payments/{id}/capture:
    post:
      operationId: capturePayment
      summary: Capture an authorized payment
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Captured
`;
    expect(await extract(doc)).toEqual(yamlGroundTruth(doc));
  });
});

/* ------------------------------------------------------------------ */
/* Charset — OpenAPI allows ANY string for operationId                 */
/* ------------------------------------------------------------------ */

describe("operationId charset — real-world ids must not be silently dropped", () => {
  const docWithId = (idLine: string): string => `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /users/{id}:
    get:
      operationId: ${idLine}
      summary: Fetch a user
      responses:
        "200":
          description: OK
`;

  it("extracts a kebab-case operationId ('get-user')", async () => {
    const doc = docWithId("get-user");
    expect(yamlGroundTruth(doc)).toEqual(["get-user"]); // fixture sanity: YAML agrees
    expect(await extract(doc)).toEqual(["get-user"]);
  });

  it("extracts a dotted operationId ('users.list')", async () => {
    const doc = docWithId("users.list");
    expect(yamlGroundTruth(doc)).toEqual(["users.list"]);
    expect(await extract(doc)).toEqual(["users.list"]);
  });

  it("extracts a quoted kebab-case operationId (\"get-user\")", async () => {
    const doc = docWithId('"get-user"');
    expect(yamlGroundTruth(doc)).toEqual(["get-user"]);
    expect(await extract(doc)).toEqual(["get-user"]);
  });

  it("extracts camelCase, snake_case and digit-bearing ids", async () => {
    const doc = `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /a:
    get:
      operationId: getUserV2
      responses:
        "200":
          description: OK
    post:
      operationId: create_user_2
      responses:
        "201":
          description: Created
`;
    expect(await extract(doc)).toEqual(["getUserV2", "create_user_2"]);
  });

  it("a trailing YAML comment after the id does not drop it", async () => {
    const doc = docWithId("getUser # the primary read path");
    expect(yamlGroundTruth(doc)).toEqual(["getUser"]); // YAML: ' #' starts a comment
    expect(await extract(doc)).toEqual(["getUser"]);
  });

  it("matches YAML ground truth on a document mixing safe and hyphenated ids", async () => {
    const doc = `openapi: 3.1.0
info:
  title: mixed-service
  version: "1.0"
paths:
  /a:
    get:
      operationId: listThings
      responses:
        "200":
          description: OK
  /b:
    post:
      operationId: create-thing
      responses:
        "201":
          description: Created
`;
    expect(await extract(doc)).toEqual(yamlGroundTruth(doc));
  });
});

/* ------------------------------------------------------------------ */
/* False positives                                                     */
/* ------------------------------------------------------------------ */

describe("operationIds — no false positives from non-operation text", () => {
  it("does not extract an 'operationId:' line inside a block-scalar description", async () => {
    const doc = `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /users:
    get:
      operationId: listUsers
      description: |-
        This endpoint replaces the legacy flow.
        operationId: notReal
        Do not reference notReal anywhere.
      responses:
        "200":
          description: OK
`;
    expect(yamlGroundTruth(doc)).toEqual(["listUsers"]); // the YAML defines exactly one op
    expect(await extract(doc)).toEqual(["listUsers"]);
  });

  it("does not extract a commented-out '# operationId: ghost'", async () => {
    const doc = `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /users:
    get:
      # operationId: ghost
      operationId: listUsers
      responses:
        "200":
          description: OK
`;
    expect(await extract(doc)).toEqual(["listUsers"]);
  });

  it("does not extract a vendor-extension 'x-operationId' key", async () => {
    const doc = `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /users:
    get:
      x-operationId: vendorThing
      operationId: listUsers
      responses:
        "200":
          description: OK
`;
    expect(await extract(doc)).toEqual(["listUsers"]);
  });

  it("does not extract an operationId from a path-item vendor extension (x-legacy)", async () => {
    // A path ITEM (not operation) may carry object-valued x-* extensions; an
    // operationId inside one is not an operation. The phantom id would make a
    // broken contract look "available" to coherence's op-exists checks — the
    // masking direction, worse than a false negative.
    const doc = `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /users:
    x-legacy:
      operationId: ghost
      migratedFrom: monolith
    get:
      operationId: listUsers
      responses:
        "200":
          description: OK
`;
    expect(yamlGroundTruth(doc)).toEqual(["listUsers"]); // the YAML defines exactly one op
    expect(await extract(doc)).toEqual(["listUsers"]);
  });

  it("ignores non-method path-item keys (summary, parameters) while keeping every method's id", async () => {
    const doc = `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /users/{id}:
    summary: User by id
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
    get:
      operationId: getUser
      responses:
        "200":
          description: OK
    delete:
      operationId: deleteUser
      responses:
        "204":
          description: Deleted
`;
    expect(await extract(doc)).toEqual(yamlGroundTruth(doc));
    expect(await extract(doc)).toEqual(["getUser", "deleteUser"]);
  });

  it("does not extract a mid-line 'operationId:' mention in a summary", async () => {
    const doc = `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /users:
    get:
      operationId: listUsers
      summary: 'set operationId: fake when regenerating clients'
      responses:
        "200":
          description: OK
`;
    expect(await extract(doc)).toEqual(["listUsers"]);
  });
});

/* ------------------------------------------------------------------ */
/* Degenerate inputs                                                   */
/* ------------------------------------------------------------------ */

describe("operationIds — missing / empty / operation-less files", () => {
  it("returns [] for a missing file", async () => {
    const root = await makeTmpDir();
    try {
      expect(await operationIds(join(root, "no-such-dir", "openapi.yaml"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns [] for an empty file", async () => {
    expect(await extract("")).toEqual([]);
  });

  it("returns [] for a document with paths but no operationIds", async () => {
    const doc = `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /users:
    get:
      summary: List users
      responses:
        "200":
          description: OK
`;
    expect(await extract(doc)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Duplicates                                                          */
/* ------------------------------------------------------------------ */

describe("operationIds — a repeated id is two slots, and says so", () => {
  const REPEATED = `openapi: 3.1.0
info:
  title: user-service
  version: "1.0"
paths:
  /payments:
    post:
      operationId: authorizePayment
      responses:
        "201":
          description: Authorized
  /payments/legacy:
    post:
      operationId: authorizePayment
      responses:
        "201":
          description: Authorized
`;

  it("keeps both slots claiming one operationId", async () => {
    // Dedup by id lost the second slot, and with it every relocation: the
    // marker at the old path and the definition at the new one are the SAME
    // id, so one of the two was invisible to the merge planner.
    const root = await makeTmpDir();
    try {
      await writeFiles(root, { "openapi.yaml": REPEATED });
      const doc = await readOpenapi(join(root, "openapi.yaml"));
      expect(doc.ops.map((o) => `${o.method} ${o.path}`)).toEqual([
        "post /payments",
        "post /payments/legacy",
      ]);
      expect(doc.ops.every((o) => o.id === "authorizePayment")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names the repeated id so a caller can grade it instead of guessing", async () => {
    const root = await makeTmpDir();
    try {
      await writeFiles(root, { "openapi.yaml": REPEATED });
      expect((await readOpenapi(join(root, "openapi.yaml"))).duplicateIds).toEqual(["authorizePayment"]);
      await writeFiles(root, { "clean.yaml": LIVING_OPENAPI });
      expect((await readOpenapi(join(root, "clean.yaml"))).duplicateIds).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records a removal marker that names no operation, which no id-keyed check can see", async () => {
    const root = await makeTmpDir();
    try {
      await writeFiles(root, {
        "openapi.yaml": `openapi: 3.1.0
paths:
  /legacy:
    post:
      x-loam-remove: true
`,
      });
      const doc = await readOpenapi(join(root, "openapi.yaml"));
      expect(doc.ops).toEqual([]);
      expect(doc.anonymousRemovals).toEqual([{ path: "/legacy", method: "post" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* serviceOperationIds — union of living + feature contract            */
/* ------------------------------------------------------------------ */

describe("serviceOperationIds — union of living and feature APIs", () => {
  const openapiWith = (title: string, ops: string[]): string => {
    const paths = ops
      .map(
        (op, i) => `  /p${i}:
    post:
      operationId: ${op}
      responses:
        "200":
          description: OK
`,
      )
      .join("");
    return `openapi: 3.1.0
info:
  title: ${title}
  version: "1.0"
paths:
${paths}`;
  };

  it("unions living and feature openapi ids, deduping the overlap", async () => {
    await withDir(
      {
        "docs/services/payment-service/openapi.yaml": openapiWith("payment-service", [
          "authorizePayment",
          "sharedOp",
        ]),
        "docs/features/FEAT-9-x/specs/payment-service/openapi.yaml": openapiWith("payment-service", [
          "createSplit",
          "sharedOp",
        ]),
      },
      async (root) => {
        const docsDir = join(root, "docs");
        const ids = await serviceOperationIds(docsDir, "payment-service", join(docsDir, "features", "FEAT-9-x"));
        expect([...ids].sort()).toEqual(["authorizePayment", "createSplit", "sharedOp"]);
      },
    );
  });

  for (const markerFirst of [true, false]) {
    it(`answers the same for a relocation with the marker ${markerFirst ? "before" : "after"} the new slot`, async () => {
      // Removals used to be applied interleaved with upserts, one operation at
      // a time, so the same change spelled in the other order answered "gone"
      // instead of "defined" — and the requirement governing it was reported
      // undefined on exactly one of the two spellings.
      const marker = `  /old:
    post:
      operationId: movedOp
      x-loam-remove: true
`;
      const upsert = `  /new:
    post:
      operationId: movedOp
      responses: { "200": { description: OK } }
`;
      await withDir(
        {
          "docs/services/payment-service/openapi.yaml": openapiWith("payment-service", ["movedOp"]),
          "docs/features/FEAT-9-x/specs/payment-service/openapi.yaml":
            `openapi: 3.1.0\npaths:\n${markerFirst ? marker + upsert : upsert + marker}`,
        },
        async (root) => {
          const docsDir = join(root, "docs");
          const ids = await serviceOperationIds(docsDir, "payment-service", join(docsDir, "features", "FEAT-9-x"));
          expect([...ids].sort()).toEqual(["movedOp"]);
        },
      );
    });
  }

  it("a feature-only service (brand-new API) yields exactly the feature's ids", async () => {
    await withDir(
      {
        "docs/features/FEAT-9-x/specs/payment-split-service/openapi.yaml": openapiWith(
          "payment-split-service",
          ["createSplit"],
        ),
      },
      async (root) => {
        const docsDir = join(root, "docs");
        const ids = await serviceOperationIds(
          docsDir,
          "payment-split-service",
          join(docsDir, "features", "FEAT-9-x"),
        );
        expect(ids).toEqual(["createSplit"]);
      },
    );
  });

  it("without a featureDir argument, yields exactly the living ids", async () => {
    await withDir(
      {
        "docs/services/payment-service/openapi.yaml": openapiWith("payment-service", [
          "authorizePayment",
          "capturePayment",
        ]),
      },
      async (root) => {
        const ids = await serviceOperationIds(join(root, "docs"), "payment-service");
        expect([...ids].sort()).toEqual(["authorizePayment", "capturePayment"]);
      },
    );
  });

  it("a featureDir without an openapi delta for the service adds nothing", async () => {
    await withDir(
      {
        "docs/services/payment-service/openapi.yaml": openapiWith("payment-service", ["authorizePayment"]),
        "docs/features/FEAT-9-x/intent.md": "# intent\n",
      },
      async (root) => {
        const docsDir = join(root, "docs");
        const ids = await serviceOperationIds(docsDir, "payment-service", join(docsDir, "features", "FEAT-9-x"));
        expect(ids).toEqual(["authorizePayment"]);
      },
    );
  });

  it("applies feature upserts and removals to the living operation set", async () => {
    await withDir(
      {
        "docs/services/payment-service/openapi.yaml": openapiWith("payment-service", [
          "authorizePayment",
          "capturePayment",
        ]),
        "docs/features/FEAT-9-x/specs/payment-service/openapi.yaml": `openapi: 3.1.0
paths:
  /p0:
    post:
      operationId: authorizePayment
      x-loam-remove: true
  /refund:
    post:
      operationId: refundPayment
      responses: { "200": { description: ok } }
`,
      },
      async (root) => {
        const docsDir = join(root, "docs");
        const ids = await serviceOperationIds(docsDir, "payment-service", join(docsDir, "features", "FEAT-9-x"));
        expect(ids).toEqual(["capturePayment", "refundPayment"]);
      },
    );
  });

  it("neither living nor feature openapi exists -> []", async () => {
    await withDir({ "docs/loam.docs.json": "{}\n" }, async (root) => {
      const docsDir = join(root, "docs");
      const ids = await serviceOperationIds(docsDir, "ghost-service", join(docsDir, "features", "FEAT-9-x"));
      expect(ids).toEqual([]);
    });
  });

  it("does not leak another service's operations", async () => {
    await withDir(
      {
        "docs/services/svc-a/openapi.yaml": openapiWith("svc-a", ["opA"]),
        "docs/services/svc-b/openapi.yaml": openapiWith("svc-b", ["opB"]),
      },
      async (root) => {
        expect(await serviceOperationIds(join(root, "docs"), "svc-a")).toEqual(["opA"]);
      },
    );
  });
});

/* ------------------------------------------------------------------ */
/* Cascade — a dropped id must not fabricate coherence-gate errors     */
/* ------------------------------------------------------------------ */

describe("cascade — extraction feeds the coherence gate", () => {
  it("validate --feature succeeds when the feature's operationId is kebab-case on all three axes", async () => {
    // Same coherent fixture, with the spine token renamed createSplit -> create-split
    // consistently in C4 metadata, requirement Operations:, and OpenAPI. All three
    // axes agree, so the gate must pass; only an extractor that drops hyphenated ids
    // can produce "not defined in OpenAPI" here.
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = FEATURE_DELTA.replaceAll("createSplit", "create-split");
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] = FEATURE_SPEC.replaceAll(
      "createSplit",
      "create-split",
    );
    files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"] = FEATURE_OPENAPI.replaceAll(
      "createSplit",
      "create-split",
    );
    expect(yamlGroundTruth(files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"]!)).toEqual([
      "create-split",
    ]);
    const p = await makeProject(files, { service: "payment-service" });
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.out).not.toContain("not defined");
      expect(res.code).toBe(0);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* operations — the deprecated flag rides beside each id               */
/* ------------------------------------------------------------------ */

describe("operations — the deprecated flag rides beside each id", () => {
  /**
   * operations() of a single inline OpenAPI document, without the content
   * digest — this family is about the flags and the slots, and the digest has
   * its own tests (test/openapi-baseline.test.ts) rather than a literal
   * repeated in every expectation here.
   */
  async function extractOps(content: string) {
    const ops = await withDir({ "openapi.yaml": content }, (root) => operations(join(root, "openapi.yaml")));
    return ops.map(({ digest: _digest, ...rest }) => rest);
  }

  it("returns deprecated: true exactly where the contract says so, false everywhere else", async () => {
    const doc = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      deprecated: true
      responses:
        "200":
          description: OK
  /payments/v2/authorize:
    post:
      operationId: authorizePaymentV2
      responses:
        "200":
          description: OK
`;
    expect(await extractOps(doc)).toEqual([
      { id: "authorizePayment", deprecated: true, remove: false, path: "/payments/authorize", method: "post" },
      { id: "authorizePaymentV2", deprecated: false, remove: false, path: "/payments/v2/authorize", method: "post" },
    ]);
  });

  it("only the boolean true counts — a string 'true' is not a deprecation", async () => {
    const doc = `openapi: 3.1.0
info:
  title: svc
  version: "1.0"
paths:
  /p:
    post:
      operationId: quotedFlag
      deprecated: "true"
      responses:
        "200":
          description: OK
`;
    expect(await extractOps(doc)).toEqual([
      { id: "quotedFlag", deprecated: false, remove: false, path: "/p", method: "post" },
    ]);
  });

  it("the flag rides the same 8-HTTP-method discipline — a vendor extension's deprecated op stays invisible", async () => {
    const doc = `openapi: 3.1.0
info:
  title: svc
  version: "1.0"
paths:
  /p:
    post:
      operationId: realOp
      responses:
        "200":
          description: OK
    x-legacy:
      operationId: ghostOp
      deprecated: true
`;
    expect(await extractOps(doc)).toEqual([
      { id: "realOp", deprecated: false, remove: false, path: "/p", method: "post" },
    ]);
  });

  it("operationIds stays the same set, in the same order — it is operations() minus the flag", async () => {
    const doc = `openapi: 3.1.0
info:
  title: svc
  version: "1.0"
paths:
  /a:
    get:
      operationId: opA
      deprecated: true
      responses:
        "200":
          description: OK
  /b:
    get:
      operationId: opB
      responses:
        "200":
          description: OK
`;
    expect(await extract(doc)).toEqual(["opA", "opB"]);
  });

  it("reads an exact feature removal marker beside its operation slot", async () => {
    const doc = `paths:
  /legacy:
    delete:
      operationId: deleteLegacy
      x-loam-remove: true
`;
    expect(await extractOps(doc)).toEqual([
      { id: "deleteLegacy", deprecated: false, remove: true, path: "/legacy", method: "delete" },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* readOpenapi — the unreadable flag                                   */
/* ------------------------------------------------------------------ */

describe("readOpenapi — a broken contract is flagged, not read as empty", () => {
  /** readOpenapi() of a single inline document. */
  async function readOf(content: string) {
    return withDir({ "openapi.yaml": content }, (root) => readOpenapi(join(root, "openapi.yaml")));
  }

  it("broken YAML yields zero ops PLUS the unreadable flag and the parser's message", async () => {
    const res = await readOf("paths: [unclosed\n  bar: ::::\n");
    expect(res.ops).toEqual([]);
    expect(res.unreadable).toBe(true);
    expect(res.error).toBeTruthy();
  });

  it("a scalar document is as unreadable as broken YAML — there is no mapping to walk", async () => {
    const res = await readOf("just some prose, not a contract\n");
    expect(res.unreadable).toBe(true);
    expect(res.ops).toEqual([]);
  });

  it("a missing file is NOT unreadable — absence is service.no-openapi's question", async () => {
    const root = await makeTmpDir();
    try {
      const res = await readOpenapi(join(root, "no-such-dir", "openapi.yaml"));
      expect(res).toEqual({ ops: [], duplicateIds: [], anonymousRemovals: [], unreadable: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("an empty file is NOT unreadable — it honestly defines nothing", async () => {
    const res = await readOf("");
    expect(res.unreadable).toBe(false);
    expect(res.ops).toEqual([]);
  });

  it("a valid contract reads exactly as before, flag down", async () => {
    const res = await readOf(LIVING_OPENAPI);
    expect(res.unreadable).toBe(false);
    expect(res.ops).toEqual([
      {
        id: "authorizePayment",
        deprecated: false,
        remove: false,
        path: "/payments/authorize",
        method: "post",
        digest: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
    ]);
  });

  it("operations() is readOpenapi() minus the flag — broken input still degrades to []", async () => {
    await withDir({ "openapi.yaml": "paths: [unclosed\n" }, async (root) => {
      expect(await operations(join(root, "openapi.yaml"))).toEqual([]);
    });
  });
});
