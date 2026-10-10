/**
 * The contract-depth probes: does an operation say anything about what it
 * returns, and does every internal `$ref` point at something.
 *
 * Form validated and depth did not, and that was invisible from the output:
 * an operation whose one response is `description: OK`, and a `$ref` to a
 * schema nobody ever wrote, both validate exactly as cleanly as a complete
 * contract even though a reader still needs the code. Everything here is a
 * PRESENCE probe over the document's own keys: nothing reads what a schema
 * says, only whether one was declared at all, so the reader's structure-only
 * stance holds.
 *
 * This module used to keep a private pointer walk rather than import the
 * merge's: the merge package already imports this package (`HTTP_METHODS` from
 * doc.ts), so the reverse import would have been a package cycle — the same
 * reason read-side `resolvePointer` copies exist on the asyncapi axis. The two
 * plain `$ref` questions now live HERE, at the axis root (`collectRefs` and
 * `resolvePointer`, at the bottom), so the private copy went: the dangling-ref
 * probe below, the merge's component closure and the reader's closure digest
 * (`closureDigester`, ./digest.ts) all ask the same two questions.
 */

/** Status codes whose response legitimately carries no body. */
const NO_CONTENT = new Set(["204", "304"]);

/**
 * True when no response declares content with a schema while at least one
 * response should carry a body — an operation with no `responses` at all
 * counts, one whose only responses are 204/304 does not. A response that is
 * itself a `$ref` counts as described: somebody wrote the shape down, and the
 * dangling case is the ref probe's finding, not this one's.
 */
export function responseUndescribed(op: unknown): boolean {
  if (op === null || typeof op !== "object") return true;
  const responses = (op as Record<string, unknown>)["responses"];
  if (responses === null || responses === undefined || typeof responses !== "object" || Array.isArray(responses)) {
    return true;
  }
  const entries = Object.entries(responses as Record<string, unknown>);
  if (entries.length === 0) return true;
  let owesBody = false;
  for (const [code, resp] of entries) {
    if (NO_CONTENT.has(code)) continue;
    owesBody = true;
    if (resp === null || typeof resp !== "object" || Array.isArray(resp)) continue;
    const rec = resp as Record<string, unknown>;
    if ("$ref" in rec) return false;
    const content = rec["content"];
    if (content === null || typeof content !== "object" || Array.isArray(content)) continue;
    for (const media of Object.values(content as Record<string, unknown>)) {
      if (media !== null && typeof media === "object" && "schema" in (media as Record<string, unknown>)) {
        return false;
      }
    }
  }
  return owesBody;
}

/**
 * The non-2xx response codes an operation declares, in document order.
 *
 * Exact three-digit codes only. `default` names no case — it is whatever else
 * happens — and the `4XX`/`5XX` wildcards name a class rather than a refusal,
 * so no scenario could be written for either and demanding one would teach an
 * author to write a scenario about nothing. 1xx and 3xx are excluded with 2xx:
 * a redirect or a continue is not the service saying no.
 */
export function failureCodesOf(op: unknown): string[] {
  if (op === null || typeof op !== "object") return [];
  const responses = (op as Record<string, unknown>)["responses"];
  if (responses === null || typeof responses !== "object" || Array.isArray(responses)) return [];
  return Object.keys(responses as Record<string, unknown>).filter((code) => /^[45]\d\d$/.test(code));
}

/**
 * Every internal `#/` reference in the document that resolves to nothing —
 * deduped, document order. External references (URLs, file paths) are out of
 * scope and never graded, matching the merge's documented stance.
 */
export function danglingRefs(root: unknown): string[] {
  // A Set keeps first-insertion order, so dedup and document order both hold.
  return [...new Set(collectRefs(root).filter((ref) => ref.startsWith("#/") && !resolvePointer(root, ref).found))];
}

/*
 * `$ref` as a pair of plain questions — which ones does this tree contain, and
 * what does one point at. Both lived in `./merge/components.ts`, beside the
 * component closure that was their only caller, until the reader needed the same
 * walk; the header says why the root and not there.
 */

/** Every `$ref` string in a tree, in document order — duplicates kept, external refs included. */
export function collectRefs(node: unknown): string[] {
  const out: string[] = [];
  const walk = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const value of current) walk(value);
      return;
    }
    if (current !== null && typeof current === "object") {
      for (const [key, value] of Object.entries(current)) {
        if (key === "$ref" && typeof value === "string") out.push(value);
        else walk(value);
      }
    }
  };
  walk(node);
  return out;
}

/** Resolve a local JSON pointer (`#/a/b~1c`) against a plain JS tree. */
export function resolvePointer(root: unknown, ref: string): { found: boolean; value: unknown } {
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
    } else if (current !== null && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: current };
}
