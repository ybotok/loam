/**
 * What counts as a Gherkin step in a scenario body — the one rule `loam gherkin`
 * emits by and `loam validate` grades by.
 *
 * It lives in a leaf of its own because both of those readers need it and they
 * sit on opposite sides of an import: `spec.ts` parses the markdown a scenario
 * is written in, `gherkin/emit.ts` renders that scenario into a `.feature` file and
 * parses requirements back out of `spec.ts` to do it. With the detector inside
 * `gherkin/emit.ts`, asking "does this scenario have any steps?" from the parser made
 * the two modules import each other, and a module-evaluation cycle is decided by
 * whichever entry point happens to be loaded first.
 *
 * Nothing here reads a file or knows what a requirement is: it is text in, shape
 * out, so both sides can depend on it and neither has to depend on the other.
 */

const STEP_KEYWORD_RE = /^(given|when|then|and|but)$/i;

export interface Step {
  /** Canonical Gherkin keyword: Given / When / Then / And / But. */
  keyword: string;
  /** The rest of the line, trimmed. May be empty. */
  text: string;
}

/**
 * Is this scenario body line a step? A step is a LIST BULLET (`-`, `*`, `+`)
 * whose text opens with Given/When/Then/And/But — case-insensitive, so the
 * OpenSpec `- **WHEN** ...` convention counts — where the keyword may be
 * wrapped in `**bold**` and may carry a trailing colon. The keyword must stand
 * alone before the step text (`- Givenx` is prose). Everything that is not a
 * step stays scenario description: prose is never dropped, only steps are
 * promoted.
 */
export function stepFromLine(line: string): Step | null {
  const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
  if (!bullet) return null;
  const rest = bullet[1]!;
  const bold = /^\*\*([^*]+?)\*\*\s*(.*)$/.exec(rest);
  let lead: string;
  let tail: string;
  if (bold) {
    lead = bold[1]!.trim();
    tail = bold[2]!;
  } else {
    const sp = /^(\S+)\s*(.*)$/.exec(rest);
    if (!sp) return null;
    lead = sp[1]!;
    tail = sp[2]!;
  }
  const kw = STEP_KEYWORD_RE.exec(lead.replace(/:$/, ""));
  if (!kw) return null;
  const word = kw[1]!.toLowerCase();
  return { keyword: word[0]!.toUpperCase() + word.slice(1), text: tail.trim() };
}

/**
 * A scenario body split for rendering: bullet lines that read as steps become
 * steps, every other non-blank line is kept (edge-trimmed) as the scenario's
 * description. Description renders BEFORE the steps whatever the source order —
 * Gherkin's grammar ends a description at the first step keyword — so prose
 * survives verbatim but interleaving does not.
 */
export function scenarioGherkin(lines: string[]): { description: string[]; steps: string[] } {
  const description: string[] = [];
  const steps: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const step = stepFromLine(line);
    if (step) steps.push(step.text.length > 0 ? `${step.keyword} ${step.text}` : step.keyword);
    else description.push(line.trim());
  }
  return { description, steps };
}
