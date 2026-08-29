/**
 * Track ``` / ~~~ fences line by line — the one rule every markdown walk in the
 * product has to agree on about what is structure and what is quoted text.
 *
 * It lived in `core/document/parse.ts` while that file was its only writer and
 * `core/provenance/sample/sections.ts` its only borrower. It moved here when the
 * fourth reader arrived and could not reach it: `core/vocabulary/steps.ts` needs
 * the same rule to stop a pipe table inside a fenced payload from being hoisted
 * out as a scenario's `Examples`, and `core/document/` already imports
 * `core/vocabulary/` (through `document/scenarios.ts`), so an import the other
 * way would close a package cycle the graph check forbids. AGENTS.md names this
 * move explicitly: when a helper you need lives in a module heavier than the
 * helper, move the helper out rather than importing the weight.
 *
 * `core/kernel/` is where it lands because it is the one package below every
 * other — it imports nothing from `core/` at all, so nobody can create a cycle
 * by depending on it.
 *
 * Returns true while the line is fenced content — INCLUDING the fence marker
 * itself. Callers that need the markers back (an emitter reading a docstring out
 * of a body, rather than a heading walk skipping over one) must track the
 * transition themselves; this predicate deliberately answers one question.
 *
 * A closing marker must match the opener's character, so a ``` block quoting a
 * ~~~ line stays open, which is what the markdown spec says and what stops a
 * payload containing fence characters from ending its own block early.
 */
export function fenceTracker(): (line: string) => boolean {
  let fence: string | null = null;
  return (line) => {
    const m = /^\s*(```|~~~)/.exec(line);
    if (m) {
      if (fence === null) fence = m[1]!;
      else if (fence === m[1]!) fence = null;
      return true;
    }
    return fence !== null;
  };
}
