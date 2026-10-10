import { readFile } from "node:fs/promises";
import { LikeC4 } from "likec4";
import { declaredService, type DeclaredService } from "../kernel/ids/service.js";
import { readDynamicViews, type ParsedView } from "./parsed/dynamic-views.js";
import { readGlobalStyleIds, readViewIds, type ViewIdClaim } from "./parsed/view-ids.js";
import { readSpecification, type DocSpecification } from "./parsed/specification.js";
import { readDeployment, type DeploymentModel } from "./parsed/deployment.js";
import { compareRels, descText, metaKey } from "./parsed/values.js";

/** A parse/validation issue reported by LikeC4. */
export interface LikeC4Error {
  message: string;
  /** As LikeC4 hands it over: an LSP range line, which starts at 0. Print it through `errorText`. */
  line?: number;
  sourceFsPath?: string;
}

/**
 * The one spelling of a diagnostic loam prints — `L<n>: <message>`, with the
 * line 1-BASED: the number an editor's gutter shows, so an agent told to open
 * it opens the line the fault is on. LikeC4's `getErrors()` copies the LSP
 * range's start line, which counts from 0, and every message used to print that
 * raw number: the named line landed one above the fault every time
 * (verification 2026-09-04, W6).
 *
 * `likec4 validate` DOES NOT AGREE, and that is deliberate rather than
 * unnoticed. Measured at the 1.59.2 pin on a document whose fault is on file
 * line 10: the CLI prints `Line 9:` and loam prints `L10:` for the same
 * diagnostic — it renders the LSP index raw. Copying that would make loam's
 * output wrong in the way the fix above repaired, so the two spellings differ
 * by exactly one and a reader comparing them should expect it.
 *
 * Four modules used to hand-roll this ternary; they all read this one now, so
 * the base cannot drift between them again.
 *
 * The message itself is BOUNDED here too, and for the same reason it lives in
 * one place: every surface that prints a LikeC4 diagnostic — validate, context,
 * show, tasks, doctor, gate, archive — prints it through this function, so this
 * is the one spelling that can keep all of them small. See `boundedMessage`.
 */
export function errorText(e: LikeC4Error): string {
  const message = boundedMessage(e.message);
  return typeof e.line === "number" ? `L${e.line + 1}: ${message}` : message;
}

/**
 * How many alternatives of a parser's "one of these possible Token sequences"
 * list a printed diagnostic keeps — the number `likec4 validate` itself prints
 * before its `...`.
 */
const TOKEN_ALTERNATIVES = 4;

/** The heading line of Chevrotain's no-viable-alternative message, whose numbered list follows it. */
const TOKEN_SEQUENCES = /possible Token sequences:$/;

/** One numbered alternative in that list: `  12. [IdTerminal, Dot]`. */
const ALTERNATIVE = /^\s+\d+\. /;

/**
 * A LikeC4 message, with Chevrotain's list of expected token sequences cut to
 * its first few alternatives and a count of the rest.
 *
 * When the parser meets a token no rule can take, Chevrotain lists EVERY token
 * sequence any rule could have accepted there — and inside a LikeC4 `model { }`
 * block that is the whole grammar. Measured at the 1.59.2 pin: deleting the
 * closing quote of one `technology '…'` makes three such messages of about
 * 6,160 lines each, and `loam validate --service` printed 18,503 lines
 * (434 KB; 458 KB as `--json`) for one keystroke. `capDetails` bounds how MANY
 * details a finding prints, never how big one is, and `loam context` has no cap
 * at all — so a broken feature delta turned a 24 KB briefing into 626 KB for
 * every agent working on any service the feature touches. An agent in the
 * check-fix loop gets nothing from alternative 4,000: what it acts on is the
 * line number and the `but found: '…'` line, which is kept.
 *
 * Upstream `likec4 validate` keeps the first five lines of any message and
 * prints `...`; this cuts the LIST only, so the `but found:` line after it
 * survives, and says how many alternatives were dropped so nothing reads as
 * complete when it is not (the convention `capDetails` uses). Any other
 * message is returned exactly as LikeC4 wrote it.
 */
function boundedMessage(message: string): string {
  const lines = message.split("\n");
  if (!TOKEN_SEQUENCES.test(lines[0] ?? "")) return message;
  const alternatives = lines.filter((line) => ALTERNATIVE.test(line)).length;
  if (alternatives <= TOKEN_ALTERNATIVES) return message;
  const kept: string[] = [];
  let seen = 0;
  for (const line of lines) {
    if (!ALTERNATIVE.test(line)) kept.push(line);
    else if (++seen <= TOKEN_ALTERNATIVES) kept.push(line);
    else if (seen === TOKEN_ALTERNATIVES + 1) kept.push(`  … (+${alternatives - TOKEN_ALTERNATIVES} more)`);
  }
  return kept.join("\n");
}

/**
 * Diagnostics as loam keeps them: each one ONCE, in line order.
 *
 * LikeC4 can report one fault more than once: measured at the 1.59.2 pin, one
 * dropped quote in a service model came back as two byte-identical messages at
 * the same line — each of them the full token list `boundedMessage` cuts — and
 * every `details` list printed both. The same message at the same line of the
 * same file is one fault; the identity includes the file because LikeC4 blames
 * a duplicate declaration on BOTH documents of a project, and those are two
 * lines an author has to look at.
 *
 * In line order because LikeC4 hands its lexer's errors over before its
 * parser's: the first location printed for that dropped quote was an
 * "unexpected character" twelve lines BELOW it, where the runaway string ended,
 * while the parser's errors two lines below it came after. The sort is stable,
 * so diagnostics on one line keep LikeC4's order, and a list mixing documents
 * stays in line order within each of them — every loader groups by document
 * after this, which is why sorting by line alone is enough. A diagnostic with
 * no line is about the document as a whole and leads.
 *
 * Applied where `getErrors()` is read (`loadSource`, `./workspace.ts`,
 * `./project/load.ts`), so every loader hands every reader the same list and
 * test/likec4-batch-parity.test.ts can keep asserting the two modes equal.
 */
export function distinctErrors<E extends LikeC4Error>(errors: readonly E[]): E[] {
  const seen = new Set<string>();
  return errors
    .filter((e) => {
      const key = `${e.sourceFsPath ?? ""}\0${e.line ?? ""}\0${e.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.line ?? -1) - (b.line ?? -1));
}

/** loam-neutral element view (flattened from the LikeC4 parsed model). */
export interface Elem {
  id: string;
  kind: string;
  title: string;
  description?: string;
  /**
   * The `services/<id>` directory this element stands for, from the element's
   * `metadata { service '...' }`. Absent on the elements nobody has bound —
   * see `elementService` for the fallback.
   */
  service?: DeclaredService;
  tags: string[];
}

/** loam-neutral relationship view. */
export interface Rel {
  source: string;
  target: string;
  title?: string;
  /** OpenAPI operationId this call uses, from the relationship's `metadata { op '...' }`. */
  op?: string;
  /**
   * AsyncAPI message this edge PRODUCES, from `metadata { publishes '...' }`.
   * Resolved against the edge SOURCE's own contract: a service publishes what it
   * declares an `action: send` for.
   */
  publishes?: string;
  /**
   * AsyncAPI message this edge CONSUMES, from `metadata { consumes '...' }`.
   * Two keys rather than one directional `message`, because the async spine is
   * not symmetric with the HTTP one: there the PROVIDER owns the contract and
   * every consumer is checked against it, while here the PRODUCER owns the
   * message and the consumer lives in another repository entirely. Which side of
   * an edge owes the declaration has to be readable from the edge itself — the
   * arrow cannot say it, because a Kafka edge points at the broker from both
   * ends.
   */
  consumes?: string;
  tags: string[];
}

export interface LoadedDoc {
  errors: LikeC4Error[];
  elements: Elem[];
  relationships: Rel[];
  /**
   * The document's `specification { }` block — what its KINDS declare, as
   * opposed to what its elements do. Optional because a document that did not
   * parse has none, and because the several `LoadedDoc` literals standing in for
   * an absent file (`show`'s missing model.likec4, `unreadableLandscape`) have
   * nothing to put here: a reader must treat "absent" and "declares nothing" the
   * same way. See `./parsed/specification.ts` for why loam reads it at all —
   * short version: since LikeC4 1.59.0 a kind can carry tags, and only the
   * specification can tell an inherited tag from an authored one.
   */
  specification?: DocSpecification;
  /**
   * The `dynamic view`s the document DECLARES — the ordered steps of a use
   * case, never a rendering (docs/DESIGN.md rule 26). Optional for exactly the
   * reason `specification` is: a document that did not parse has none, and the
   * several `LoadedDoc` literals standing in for an absent file have nothing to
   * put here. Absent and empty mean the same thing to every reader — no views
   * were declared, or none could be read — and neither is a finding: a fleet
   * that draws no diagrams owes loam no views block.
   */
  views?: ParsedView[];
  /**
   * The ids of every view the document AUTHORS, static ones included — a census,
   * not a read of what any of them shows. Separate from `views` above because
   * the two answer different questions off different filters (see
   * `./parsed/view-ids.ts`), and because a static view contributes an id and
   * nothing else loam may look at.
   */
  viewIds?: ViewIdClaim[];
  /**
   * The ids of every GLOBAL STYLE the document declares — `global { styleGroup
   * <id> { … } }` and the single-rule `global { style <id> … }` alike, since
   * LikeC4 files both under one id table (hence not `styleGroups`). A
   * declaration census exactly as `viewIds` is: the ids, sorted, and never a
   * rule inside one (docs/DESIGN.md rule 26 says why a style is a rendering
   * instruction loam may not read). One consumer — the generated subsystem
   * views, which reference the group named `subsystems` when it is declared
   * and nothing otherwise, because a reference to an undeclared id is a parse
   * error that blanks the whole `architecture/` project in the renderer.
   * Optional for the reason `views` is: a document that did not parse has
   * none, and the `LoadedDoc` literals standing in for an absent file have
   * nothing to put here; absent and empty mean the same thing to every reader.
   */
  globalStyles?: string[];
  /**
   * The `deployment { }` model the document declares — nodes, instances and the
   * edges between them (`./parsed/deployment.ts`). Optional for the reason
   * `views` is, and read the same way by every consumer: absent and empty mean
   * "no topology", and neither is a finding. A fleet that draws no deployment
   * owes loam none, which is also the whole opt-in the axis has.
   */
  deployment?: DeploymentModel;
}

/**
 * The slice of a LikeC4 model loam reads: elements and relationships, and on
 * each of those only id/kind/title/description/tags/metadata.
 *
 * It is a type of its own, rather than an inline cast at the one call site,
 * because BOTH of LikeC4's model stages expose exactly this slice — which is
 * what makes the cheap stage a safe substitute for the expensive one. The
 * substitution is pinned in test/likec4-model-parity.test.ts, which flattens
 * both stages through `flattenModel` below and compares the results.
 *
 * Views are deliberately NOT in this interface, even though loam does read them.
 * What this interface pins is the two-stage PARITY that makes the cheap stage a
 * safe substitute for the expensive one — and the stages are not claimed to
 * agree about views, nor need to: the parsed stage is the only one rule 26
 * permits. That read has its own adapter, `./parsed/dynamic-views.ts`.
 */
export interface ReadableModel {
  elements: () => Iterable<{
    id: string;
    kind: string;
    title: string;
    description?: unknown;
    tags?: readonly string[];
    metadata?: unknown;
  }>;
  relationships: () => Iterable<{
    source: { id: string };
    target: { id: string };
    title?: string | null;
    tags?: readonly string[];
    metadata?: unknown;
  }>;
  /**
   * The parsed `specification { }` block. Typed `unknown` and normalized by
   * `readSpecification` rather than described here, because it is NOT part of
   * the two-stage parity this interface pins: the shape is LikeC4's internal
   * record (1.59.2 spells element-kind tags and relationship-kind tags
   * differently), and writing it out here would be a structural claim about a
   * dependency's internals that the compiler would then enforce against us.
   */
  specification?: unknown;
}

/** Flatten a LikeC4 model into loam's neutral `Elem`/`Rel` view. */
export function flattenModel(model: ReadableModel): { elements: Elem[]; relationships: Rel[] } {
  const elements: Elem[] = [...model.elements()].map((e) => {
    // The one crossing between LikeC4's parse output and loam's type system:
    // a `metadata { service '...' }` binding is text somebody wrote, and this
    // is where it acquires a type that says so.
    const bound = metaKey(e.metadata, "service");
    return {
      id: e.id,
      kind: e.kind,
      title: e.title,
      description: descText(e.description),
      ...(bound === undefined ? {} : { service: declaredService(bound) }),
      tags: [...(e.tags ?? [])],
    };
  });
  const relationships: Rel[] = [...model.relationships()]
    .map((r) => ({
      source: r.source.id,
      target: r.target.id,
      // LikeC4 reports an untitled edge as title: null — normalize to the declared `title?: string`.
      title: r.title ?? undefined,
      op: metaKey(r.metadata, "op"),
      publishes: metaKey(r.metadata, "publishes"),
      consumes: metaKey(r.metadata, "consumes"),
      tags: [...(r.tags ?? [])],
    }))
    // One order for every run and machine: `compareRels` (./parsed/values.ts) says why LikeC4 gives none.
    .sort(compareRels);
  return { elements, relationships };
}

/**
 * Load and validate a single self-contained `.likec4` document, in-process
 * (no external tool, no JVM). Returns validation errors and, if clean, the
 * flattened elements + relationships.
 */
export async function loadFile(path: string): Promise<LoadedDoc> {
  return loadSource(await readFile(path, "utf8"));
}

/**
 * `loadFile` for text that is not (yet) on disk — what the archive merge uses
 * to prove a computed landscape parses BEFORE anything is written.
 */
export async function loadSource(src: string): Promise<LoadedDoc> {
  // LikeC4 owns a Langium workspace and registers a process-exit listener for
  // it. Validation creates many short-lived instances, so every acquired
  // instance must be disposed even on an invalid document or a failed model
  // computation. Its logger is disabled because diagnostics are returned in
  // LoadedDoc instead of being written out-of-band to stderr.
  const likec4 = await LikeC4.fromSource(src, { logger: false });
  try {
    // Assigned, not cast: LikeC4 declares `getErrors()` as a non-nullable array
    // whose element type is structurally wider than ours, so the compiler can
    // check the shape here. The cast was the only thing standing between a
    // dependency renaming `message` and a build that still succeeded — and the
    // `?? []` it carried could never fire. Through `distinctErrors`, as every
    // loader's diagnostics are, so this one agrees with the batch loader.
    const errors: LikeC4Error[] = distinctErrors(likec4.getErrors());
    if (errors.length > 0) {
      return { errors, elements: [], relationships: [] };
    }

    // `parsedModel`, not `computedModel`: the computed stage RESOLVES every
    // view — expanding its predicates against the model and deriving the
    // ancestor edges a diagram needs (and computing a default view when the
    // document declares none). loam reads what a view DECLARES and never what a
    // view SHOWS (docs/DESIGN.md rule 26), so none of that resolution is ever
    // wanted; it renders nothing. That work is superlinear in the number of
    // RELATIONSHIPS, so a landscape at fleet shape turned `loam list` from under
    // a second into minutes. The elements and relationships below are identical
    // either way. The `await` is load-bearing for anything reading `$data`: it is
    // undefined on the unresolved promise.
    return cleanDoc((await likec4.parsedModel()) as ReadableModel);
  } finally {
    await likec4.dispose();
  }
}

/**
 * Everything loam reads out of one document that parsed clean, from LikeC4's
 * parsed stage. Shared with `./workspace.ts`'s batch loader, which used to
 * spell the same six reads out again: an adapter wired into one loader and not
 * the other reads as an absence rather than an error, the failure
 * test/likec4-batch-parity.test.ts exists to catch. `./project/load.ts` keeps
 * its own `cleanProjectDoc` because a project's record requires the fields this
 * one leaves optional.
 */
export function cleanDoc(model: ReadableModel): LoadedDoc {
  return {
    errors: [],
    specification: readSpecification(model.specification),
    views: readDynamicViews(model),
    viewIds: readViewIds(model),
    globalStyles: readGlobalStyleIds(model),
    deployment: readDeployment(model),
    ...flattenModel(model),
  };
}
