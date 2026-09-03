/**
 * Parity between the two ways loam parses a `.likec4` document from disk:
 * `loadFile` (one fresh workspace per document — what single-service validate
 * pays) and `loadBatch` (one shared multi-project workspace for the whole run —
 * what `validate --all` prefetches through).
 *
 * The batch loader leans on likec4's multi-project workspace behaviour —
 * per-folder `likec4.config.json`, `parsedModel(project)`, `getErrors()`
 * attribution by `sourceFsPath` — which is public API but not documented for
 * this use. The dependency is exact-pinned at 1.59.2, and THIS suite is the
 * tripwire: an upgrade that merges projects, reattributes errors, or starts
 * resolving cross-project imports must fail here before it lands. Every corpus
 * document is asserted equal across both modes on elements, relationships and
 * every error's {message, line}; sourceFsPath is asserted to be the document's
 * REAL path to keep the field honest for a future consumer — nothing renders
 * it today (errorText prints only `L<line>: <message>`), so `message` is the
 * pass-through a tmp path could still leak into.
 *
 * The sibling-import case is the one that looks paranoid and is not: in a
 * shared workspace an author-written `import ... from '<name>'` resolves if any
 * sibling project has that name, which is exactly what `fromSource`'s
 * per-document isolation refuses. The batch names its projects with a
 * crypto-random per-invocation token, so the guess below must fail identically
 * in both modes — remove the token and this test fails, which is the point.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { loadFile, type LoadedDoc } from "../src/core/c4/likec4.js";
import { loadBatch } from "../src/core/c4/workspace.js";
import { makeTmpDir, writeFiles } from "./helpers/harness.js";

/**
 * The rich model shape from test/likec4-model-parity.test.ts: nested/dotted
 * containers, `metadata { service }` on a system and a container, `op` /
 * `publishes` / `consumes` on relationships, declared and kind-inherited tags,
 * an `it`-declared relationship, an `extend` block, a title fallback, and an
 * untitled edge — everything the adapter reads, in one document.
 */
const RICH = `specification {
  element person
  element softwareSystem {
    #owned
  }
  element container
  element database
  deploymentNode region
  deploymentNode cluster
  tag owned
  tag external
  tag critical
}

model {
  customer = person 'Customer'

  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
    metadata { service 'checkout-web' }
    ui = container 'checkout-ui' {
      description 'The browser app'
    }
  }

  paymentService = softwareSystem 'payment-service' {
    #critical
    description 'Owns payment authorization/capture'
    metadata { service 'payment-service' }
    api = container 'payment-api' {
      metadata { service 'payment-service' }
    }
    worker = container 'payment-worker' {
      it -> kafka 'Publishes PaymentAuthorized' {
        metadata { publishes 'payment.PaymentAuthorized' }
      }
    }
    db = database 'payment-db' {
      #critical
    }
    api -> db 'Reads and writes'
  }

  ledger = softwareSystem {
    metadata { service 'ledger-service' }
  }

  kafka = softwareSystem 'kafka' {
    #external
    description 'Event backbone'
  }

  extend ledger {
    api = container 'ledger-api'
  }

  customer -> checkoutWeb.ui 'Uses'
  checkoutWeb.ui -> paymentService.api 'Authorizes' {
    #critical
    metadata { op 'authorizePayment' }
  }
  checkoutWeb -> paymentService.api 'Captures' {
    metadata { op 'capturePayment' }
  }
  paymentService.api -> ledger.api 'Posts entries' {
    metadata { op 'postEntry' }
  }
  ledger -> kafka
  kafka -> ledger.api 'PaymentAuthorized' {
    metadata { consumes 'payment.PaymentAuthorized' }
  }
}

deployment {
  eu = region 'EU-West' {
    a = cluster 'cluster-a' {
      instanceOf paymentService.api
      dbA = instanceOf paymentService.db
    }
    b = cluster 'cluster-b' {
      dbB = instanceOf paymentService.db
    }
    a.dbA -> b.dbB 'Streams WAL'
  }
}

global {
  styleGroup fleetPalette {
    style element.tag = #external { color gray }
  }
}
`;

/** An unresolved reference: two Langium errors with real line numbers. */
const INVALID = `specification {
  element softwareSystem
}
model {
  a = softwareSystem 'svc-bad'
  a -> nosuchthing 'Calls'
}
`;

/**
 * A metadata key written twice parses as an array with no error; both readers
 * must take the FIRST value (the text scanner's keyedLiteral rule), and the
 * explicit pin below keeps parity on two identically WRONG readings failing.
 */
const DUPLICATE_META = `specification {
  element softwareSystem
}
model {
  a = softwareSystem 'svc-dup' {
    metadata { service 'first-wins' service 'silently-dropped' }
  }
}
`;

/** Rich-text descriptions: a markdown block and a plain string side by side. */
const RICH_DESC = `specification {
  element softwareSystem
}
model {
  a = softwareSystem 'svc-md' {
    description '''
      # Heading

      A **markdown** description.
    '''
  }
  b = softwareSystem 'svc-plain' {
    description 'plain text'
  }
  a -> b 'Calls' {
    metadata { op 'describedOp' }
  }
}
`;

/** The valid shape again, but with CRLF line endings, byte-copied as-is. */
const CRLF =
  "specification {\r\n  element softwareSystem\r\n}\r\nmodel {\r\n  a = softwareSystem 'svc-crlf' {\r\n    metadata { service 'svc-crlf' }\r\n  }\r\n  b = softwareSystem 'svc-crlf-peer'\r\n  a -> b 'Calls' {\r\n    metadata { op 'crlfOp' }\r\n  }\r\n}\r\n";

/**
 * The isolation tripwire: a document guessing the batch's sibling-project
 * naming scheme. Without the random token the first staged folder would be
 * named exactly `p0`, this import would RESOLVE in batch mode, and the
 * document would grade clean where `fromSource` refuses it — a silently
 * weakened rule. With the token, both modes refuse with identical errors.
 */
const IMPORT_GUESS = `import { a } from 'p0'

specification {
  element softwareSystem
}
model {
  b = softwareSystem 'svc-guessing'
  b -> a 'Calls sibling'
}
`;

const CORPUS: Record<string, string> = {
  "rich.likec4": RICH,
  "invalid.likec4": INVALID,
  "duplicate-meta.likec4": DUPLICATE_META,
  "rich-desc.likec4": RICH_DESC,
  "crlf.likec4": CRLF,
  "import-guess.likec4": IMPORT_GUESS,
};

/** {message, line} per error — the two fields findings render. */
const errKeys = (doc: LoadedDoc) => doc.errors.map((e) => ({ message: e.message, line: e.line }));

describe("loadBatch parses every corpus document exactly as loadFile does", () => {
  /** One corpus on disk, one batch, one per-file load each — shared by every pin. */
  async function corpus(): Promise<{
    root: string;
    batch: Map<string, LoadedDoc>;
    singles: Map<string, LoadedDoc>;
  }> {
    const root = await makeTmpDir("loam-batch-parity-");
    await writeFiles(root, CORPUS);
    const paths = Object.keys(CORPUS).map((name) => join(root, name));
    const batch = await loadBatch(paths);
    const singles = new Map<string, LoadedDoc>();
    for (const path of paths) singles.set(path, await loadFile(path));
    return { root, batch, singles };
  }

  it("agrees with loadFile on elements, relationships, deployment, and every error's {message, line}", async () => {
    const { root, batch, singles } = await corpus();
    try {
      for (const [path, single] of singles) {
        const batched = batch.get(path);
        expect(batched, path).toBeDefined();
        expect(batched!.elements, path).toEqual(single.elements);
        expect(batched!.relationships, path).toEqual(single.relationships);
        // The deployment model travels through a THIRD loader, and it is the
        // one a missing call would hide in: `loadBatch` builds its own
        // `LoadedDoc` literal rather than sharing `loadSource`'s, so an adapter
        // wired into one and not the other reads as "this fleet declares no
        // topology" — silence, in the loader `validate --all` actually uses.
        expect(batched!.deployment, path).toEqual(single.deployment);
        // The global style census travels the same third road, and a loader
        // that forgot it would read as "this fleet declares no palette" — in
        // which case the generated subsystem views reference nothing while
        // `sync`, through the project loader, writes the line: a stale file
        // no command could clear.
        expect(batched!.globalStyles, path).toEqual(single.globalStyles);
        expect(errKeys(batched!), path).toEqual(errKeys(single));
      }
      // The corpus exercises both verdicts, or the loop above proves nothing.
      expect(errKeys(singles.get(join(root, "rich.likec4"))!)).toEqual([]);
      expect(errKeys(singles.get(join(root, "invalid.likec4"))!).length).toBeGreaterThan(0);
      // And it exercises a document that HAS a deployment model, or the
      // equality above is two empties agreeing.
      const richDeployment = singles.get(join(root, "rich.likec4"))!.deployment;
      expect(richDeployment?.nodes.map((n) => n.id)).toEqual(["eu", "eu.a", "eu.b"]);
      expect(richDeployment?.instances.map((i) => i.element)).toEqual([
        "paymentService.api",
        "paymentService.db",
        "paymentService.db",
      ]);
      // And a document that DECLARES a global style group, or the equality
      // above is `[]` agreeing with `[]`.
      expect(singles.get(join(root, "rich.likec4"))!.globalStyles).toEqual(["fleetPalette"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("an errored document has empty elements and relationships in BOTH modes", async () => {
    const { root, batch, singles } = await corpus();
    try {
      for (const name of ["invalid.likec4", "import-guess.likec4"]) {
        const path = join(root, name);
        for (const doc of [batch.get(path)!, singles.get(path)!]) {
          expect(doc.errors.length, name).toBeGreaterThan(0);
          expect(doc.elements, name).toEqual([]);
          expect(doc.relationships, name).toEqual([]);
          // Errors mean no model, and the census is part of the model: an
          // errored document declares NO style ids in either mode, so the
          // generated views can never reference a group out of a map that
          // did not parse.
          expect(doc.globalStyles, name).toBeUndefined();
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("batch errors carry the document's real path, never the workspace copy's", async () => {
    const { root, batch } = await corpus();
    try {
      const path = join(root, "invalid.likec4");
      const errors = batch.get(path)!.errors;
      expect(errors.length).toBeGreaterThan(0);
      for (const err of errors) {
        expect(err.sourceFsPath).toBe(path);
        expect(err.sourceFsPath).not.toContain("loam-c4-");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a sibling-project import guess refuses identically in both modes", async () => {
    const { root, batch, singles } = await corpus();
    try {
      const path = join(root, "import-guess.likec4");
      const batched = batch.get(path)!;
      // The guess must FAIL — specifically as an unfound project, proving the
      // random token kept the sibling unnameable — and fail the same way the
      // per-document workspace fails it.
      expect(batched.errors.map((e) => e.message)).toContain("Imported project not found");
      expect(errKeys(batched)).toEqual(errKeys(singles.get(path)!));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a duplicated metadata key takes the first value in both modes", async () => {
    const { root, batch, singles } = await corpus();
    try {
      const path = join(root, "duplicate-meta.likec4");
      for (const doc of [batch.get(path)!, singles.get(path)!]) {
        expect(doc.errors).toEqual([]);
        expect(doc.elements[0]?.service).toBe("first-wins");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("dedupes repeated paths and drops a path that cannot be staged", async () => {
    const root = await makeTmpDir("loam-batch-parity-");
    try {
      await writeFiles(root, { "one.likec4": CRLF });
      const good = join(root, "one.likec4");
      const missing = join(root, "never-written.likec4");
      const batch = await loadBatch([good, good, missing]);
      // The missing path is ABSENT, not an error entry: the caller's ordinary
      // per-path load owns reproducing today's ENOENT exactly.
      expect([...batch.keys()]).toEqual([good]);
      expect(batch.get(good)!.errors).toEqual([]);
      await expect(loadFile(missing)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
