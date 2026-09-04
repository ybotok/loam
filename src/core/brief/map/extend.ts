/**
 * Which element of the fleet map an extending `model.likec4` says it is inside,
 * and what the brief's model example prints where the map has no answer.
 *
 * A module of its own beside `./owed.ts` for the reason that package exists: the
 * two are the fleet map's half of the brief, and `brief.ts` — which resolves the
 * artifact list against a docs repo — went past the file cap carrying the
 * substitution and its three-state reasoning. The subjects are distinct: this
 * one is about the ONE token an agent copies into three code positions, and
 * getting it wrong writes a model that cannot parse.
 *
 * Type-only import from `../` (`LandscapeContext`), which `verbatimModuleSyntax`
 * erases — so this package still value-imports nothing from its parent and the
 * package graph stays acyclic.
 */
import type { LandscapeContext } from "../landscape.js";

/** The literals `targets.ts` leaves in the model target for this module to fill in. */
export const FQN = "<fqn>";
/**
 * The service being adopted, in the model example's header. It is a placeholder
 * for the same reason `<fqn>` is: the example is handed to an agent that copies
 * it, and a header naming payment-service travelled verbatim into every other
 * service's model — the more convincingly for sitting one line above an
 * `extend` the brief HAD substituted.
 */
export const SVC = "<svc>";

/** The token an example carries where loam has no id to substitute. Short on purpose — see `ExtendPoint`. */
const PLACEHOLDER = "<your-element-id>";

/** What every `<fqn>` becomes, and the sentence that explains a placeholder. */
export interface ExtendPoint {
  id: string;
  /**
   * Why `id` is a placeholder, carried ONCE as a comment above the example
   * rather than substituted into it. `<fqn>` occupies three code positions —
   * the `extend` line, the source of a container edge, and `view of` — and the
   * explanation only reads as an instruction in the first: a 103-character
   * English sentence standing in for an id inside `view of … { include * }` is
   * noise the agent has to read past, on the command's most common invocation.
   */
  note?: string;
}

/**
 * Which element an extending `model.likec4` says it is inside — the id, when
 * the map leaves no doubt, and a placeholder plus the doubt when it does.
 *
 * Four answers because the map is in four states and only one of them has an
 * answer to give. With exactly ONE service-level element resolving to this
 * service, `extend <that id> {` is the file's first line and printing anything
 * else makes an agent go and look it up. With NONE, there is nothing to extend
 * yet — the landscape target below this one is what the agent must do first, and
 * saying so is what stops it inventing an id and writing a model that cannot
 * parse. With SEVERAL — `landscape.binding-duplicate`, a real and reported
 * state — loam must not choose: every element→service join in the fleet picks
 * one of them arbitrarily, so a brief that named one would be teaching an agent
 * the arbitrary answer as the right one. And when the map could not be READ
 * (`modelled === null`) the empty element list is evidence of nothing: "write
 * the element into the map first" is exactly the instruction that draws a second
 * box for a service the map already holds, so that arm says the map is
 * unreadable and asks for no map write at all.
 */
export function extendPoint(landscape: LandscapeContext): ExtendPoint {
  if (landscape.modelled === null) {
    return {
      id: PLACEHOLDER,
      note:
        "the fleet map (architecture/) does not parse, so loam cannot say which element binds this directory. " +
        "Fix the map first — the landscape section of this brief names the documents that failed — then write " +
        "the id of the element that resolves to this service here.",
    };
  }
  const ids = landscape.elements.map((e) => e.id);
  const [only, ...rest] = ids;
  if (only === undefined) {
    return {
      id: PLACEHOLDER,
      note:
        "nothing in the fleet map resolves to this directory yet. Add the element to " +
        "architecture/landscape.likec4 first — the landscape target below — then write its id here.",
    };
  }
  return { id: rest.length === 0 ? only : `<one of: ${ids.join(", ")}>` };
}

/**
 * An example with its placeholders resolved, and the placeholder's explanation
 * prepended as a comment when there is one.
 *
 * Guarded on the example actually containing `<fqn>`: the note is about that
 * substitution, and heading an example that never had one with it would answer a
 * question its reader did not ask.
 */
export function exampleFor(example: string, extend: ExtendPoint, service: string): string {
  const body = example.replaceAll(FQN, extend.id).replaceAll(SVC, service);
  if (extend.note === undefined || !example.includes(FQN)) return body;
  return `${commentLines(`${extend.id} is a placeholder: ${extend.note}`)}\n\n${body}`;
}

/** One sentence as `//` lines, wrapped to the width the examples around it are written at. */
function commentLines(text: string, width = 76): string {
  const out: string[] = [];
  let line = "//";
  for (const word of text.trim().split(/\s+/)) {
    if (line !== "//" && line.length + 1 + word.length > width) {
      out.push(line);
      line = `// ${word}`;
    } else line = `${line} ${word}`;
  }
  out.push(line);
  return out.join("\n");
}
