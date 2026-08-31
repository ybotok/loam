/**
 * What a delta may declare that the landscape merge cannot carry.
 *
 * `planLandscapeMerge` splices out of the delta's `model { }` block and nothing
 * else. That is correct — the living landscape is a model plus the views its own
 * authors chose — but it used to be SILENT: a delta declaring `deployment { }`
 * or a `dynamic view` archived at exit 0, reported `+N element(s), +M
 * relationship(s)` exactly as usual, and the block was simply gone. The merge's
 * own parse net cannot catch it either, because a landscape missing a deployment
 * model is perfectly legal — there is nothing to fail on. Nobody finds out until
 * somebody goes looking for a diagram that was archived months ago.
 *
 * So the loss is made a refusal, which is the same doctrine as the merge's other
 * mechanical refusals (an unlocatable declaration, two statements on one line):
 * the input cannot be spliced as authored, `--approve` deliberately does not
 * override it — that flag overrides loam's JUDGMENT about coherence, never its
 * ability to carry an axis — and nothing is written.
 *
 * ## Why views are graded and not simply banned
 *
 * `loam new` scaffolds a `views { view <feat> { include * } }` block into every
 * delta.likec4 (commands/new/templates.ts), so refusing the block outright would
 * refuse loam's own scaffold on its first archive. It is there to be RENDERED
 * while the feature is in flight, and it is meant not to travel.
 *
 * The line drawn here is recoverability, and it is the only line that survives
 * the scaffold:
 *
 *  - A static `view` is a rendering OF the model. Once the merge lands, the
 *    whole model is in landscape.likec4, so the author can restate the view
 *    there at any time from information that still exists. Dropping it loses a
 *    convenience.
 *  - A `dynamic view`'s ordered steps, and a `deployment { }` block's topology,
 *    exist in NO other document the fleet keeps. When the merge drops those,
 *    the information is gone. That is what gets refused. Rule 26 sharpens the
 *    stakes rather than the rule: a `dynamic view`'s steps are now something
 *    loam READS, so dropping one silently would discard checked content, not
 *    merely a convenience.
 *
 * A residual is accepted knowingly: a delta carrying a SECOND static view still
 * loses it without a word. Refusing that would mean telling an author with two
 * preview views to delete one, which is a false refusal on a harmless file, and
 * the loss there is recoverable by the argument above.
 *
 * ## The dynamic-view refusal is unchanged; its ADVICE moved
 *
 * A `dynamic view` still cannot ride inside `delta.likec4`, and the reason is
 * mechanical rather than a policy about where flows belong: this document
 * re-declares the landscape's own identifiers to anchor its new edges and
 * carries its own `specification` block because LikeC4 parses it standalone, so
 * it cannot be staged beside the map in one project — a duplicate specification
 * is an error blamed on both files, and a re-declared element is a duplicate id.
 * What changed is where the refusal sends the author. It used to say
 * `architecture/landscape.likec4`, which was the only honest answer while the
 * axis had no feature-delta path: a flow could not ship with the change that
 * made it true. `features/<FEAT>/usecases/<name>.likec4` is that path
 * (`core/usecases/delta/flows.ts`), and it is a views-only document — which is
 * exactly why it stages beside the map when this one cannot.
 */
import { maskSource, matchBrace } from "../source-mask.js";
import { LandscapeSpliceError } from "./contract.js";

/**
 * Top-level blocks a delta can declare. `specification` and `model` are absent
 * on purpose: the specification is re-declared in every delta because LikeC4
 * parses each one standalone, and the model is the thing being spliced.
 */
const TOP_LEVEL_BLOCK = /\b(deployment|global|views)\s*\{/g;

/** A `dynamic view` / `deployment view` inside a views block — the irrecoverable kinds. */
const AUTHORED_VIEW = /\b(dynamic|deployment)\s+view\b/;

function refuse(block: string, detail: string, home: string): never {
  throw new LandscapeSpliceError(
    `delta.likec4 declares ${detail}, and the landscape merge splices only what is inside \`model { }\` — ` +
      `archiving would drop it silently, so nothing was written. Move the ${block} into ` +
      `${home} and re-run the archive.`,
  );
}

/** Where the living documents keep what this delta cannot carry. */
const LANDSCAPE_HOME = "architecture/landscape.likec4, where the living documents keep it,";

/** Where a FEATURE keeps a flow — a slot of its own, not the living tree. See the header. */
const FLOW_HOME =
  "features/<FEAT>/usecases/<name>.likec4 — a views-only document of its own, which `loam archive` copies into " +
  "architecture/usecases/ and `loam unarchive` takes back —";

/**
 * Refuse a delta whose non-model blocks the merge would discard.
 *
 * Runs over MASKED source, so a `deployment {` written inside a comment or a
 * description string cannot trigger it — the same masking discipline
 * `scanModel` splices under, and for the same reason: this refuses an archive,
 * and a refusal a comment can provoke is worse than the silence it replaced.
 *
 * Brace depth is tracked in one forward pass rather than recounted per match:
 * only a block at depth 0 is a top-level declaration, and `deployment` at depth
 * 1 is an ordinary `specification { deploymentNode … }` or a view predicate.
 */
export function assertMergeableDelta(deltaText: string): void {
  const { code } = maskSource(deltaText);
  let depth = 0;
  let cursor = 0;
  for (const m of code.matchAll(TOP_LEVEL_BLOCK)) {
    for (; cursor < m.index; cursor += 1) {
      if (code[cursor] === "{") depth += 1;
      else if (code[cursor] === "}") depth -= 1;
    }
    if (depth !== 0) continue;
    const block = m[1]!;
    if (block !== "views") {
      refuse(`\`${block} { }\` block`, `a top-level \`${block} { }\` block`, LANDSCAPE_HOME);
    }
    const open = m.index + m[0].length - 1;
    const close = matchBrace(code, open);
    const inner = code.slice(open + 1, close === -1 ? code.length : close);
    const authored = AUTHORED_VIEW.exec(inner);
    if (authored !== null) {
      const kind = authored[1]!;
      refuse(
        `\`${kind} view\``,
        `a \`${kind} view\` in its \`views { }\` block — a view of that kind describes ordering or topology ` +
          `recorded in no other document, unlike the static preview view \`loam new\` scaffolds`,
        // A deployment view is topology and belongs in the living map; a dynamic
        // view is a flow, and a flow now has a feature slot of its own. Sending
        // an author to the living landscape for one they are introducing WITH
        // this change was the advice that made the axis's headline case a
        // two-pull-request job.
        kind === "dynamic" ? FLOW_HOME : LANDSCAPE_HOME,
      );
    }
  }
}
