/**
 * Every markdown link a document writes, as data.
 *
 * A link between documents in a docs repo is a JOIN, not decoration — a
 * requirement that names a domain term points at that term's definition, and an
 * ADR that supersedes another says which. `SCHEMA.md` and the generated
 * `AGENTS.md` have stated the convention (standard markdown links, relative
 * path targets) since the fleet-ADR work; this module is what finally reads
 * one, so `./findings.ts` can answer the only question the convention was
 * chosen for: does the target exist.
 *
 * WHY A PARSER RATHER THAN A REGEX AT THE CALL SITE. Two classes of false
 * positive make the naive `\[.*\]\(.*\)` unusable on the documents loam owns,
 * and both occur in loam's OWN generated prose. A fenced block is where a
 * document SHOWS the convention — the `AGENTS.md` section that teaches the link
 * format contains a link nobody wrote to be followed — and an inline code span
 * is where prose quotes a path. Both must read as text. The fence rule is the
 * one `core/document/parse.ts` already applies to headings, and it is imported
 * rather than restated for the reason that module gives about its own sampler:
 * two readers disagreeing about what a fence encloses prescribe a document no
 * author can satisfy.
 */
import { relative, resolve, sep } from "node:path";
import { fenceTracker } from "../document/parse.js";

/** One link written in a markdown document. */
export interface DocumentLink {
  /** The target exactly as written, angle brackets stripped, fragment included. */
  raw: string;
  /**
   * The FILE half — `raw` with any `#fragment` removed and percent-escapes
   * decoded. This is what resolves against the filesystem; `raw` is what the
   * finding quotes back, because that is the string the author has to find.
   */
  path: string;
  /** The link text, or the reference label for a definition. Quoted in the finding. */
  text: string;
  /** 1-based line the link was written on. */
  line: number;
}

/**
 * Inline links and images: `[text](target)`, `![alt](target)`,
 * `[text](<target with spaces>)`, `[text](target "title")`.
 *
 * The target alternation takes `<...>` first so an angle-bracketed path
 * containing spaces stays one token; the bare form stops at whitespace or `)`,
 * which gives up on the balanced-parens spelling markdown also allows
 * (`[x](a(1).md)`). That is a deliberate under-read: it costs a link nobody
 * writes, where over-reading would swallow the rest of a sentence and report a
 * target no author would recognise.
 */
const INLINE_RE = /!?\[([^\]]*)\]\(\s*(<[^>\n]*>|[^\s)]*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gd;

/**
 * A reference DEFINITION — `[label]: target "title"` on its own line. Included
 * because the target is the same join written in a different place: a document
 * that collects its links at the bottom is following the convention, and a
 * reader that only saw inline links would grade it as having none.
 */
const DEFINITION_RE = /^ {0,3}\[([^\]]+)\]:\s*(<[^>\n]*>|\S+)/d;

/**
 * Code spans, blanked before matching. `\`[a](b)\`` is prose ABOUT a link and
 * resolving it would convict a document for explaining the convention. Blanked
 * to spaces rather than removed so every column after it — and therefore any
 * real link later on the same line — keeps its position.
 */
const CODE_SPAN_RE = /(`+)(?:[^`]|(?!\1)`)*\1/g;

/**
 * Every link in `md`, in document order.
 *
 * The whole document is scanned, frontmatter included: a YAML `see: [x](y.md)`
 * is not a link loam wrote a field for, and the alternative — teaching this
 * module where frontmatter ends — would make it read the one part of a document
 * loam's own doctrine says is structured. A link that resolves is a link that
 * resolves wherever it is written.
 */
export function documentLinks(md: string): DocumentLink[] {
  const fenced = fenceTracker();
  const out: DocumentLink[] = [];
  md.split(/\r?\n/).forEach((rawLine, i) => {
    if (fenced(rawLine)) return;
    const line = rawLine.replace(CODE_SPAN_RE, (m) => " ".repeat(m.length));
    const definition = DEFINITION_RE.exec(line);
    if (definition) {
      push(out, definition[2]!, definition[1]!, i + 1);
      return;
    }
    INLINE_RE.lastIndex = 0;
    for (let m = INLINE_RE.exec(line); m !== null; m = INLINE_RE.exec(line)) {
      push(out, m[2]!, m[1]!, i + 1);
    }
  });
  return out;
}

/**
 * Record one link, unless its target is not a path this repository can answer
 * for. Four exclusions, each of them a question with no filesystem answer
 * rather than a link loam declines to grade:
 *
 * - an EMPTY target (`[text]()`) addresses nothing;
 * - a SCHEME (`https:`, `mailto:`, and a Windows `C:` drive with it) addresses
 *   something outside this repository;
 * - a ROOT-relative or protocol-relative target (`/x`, `//host/x`) is resolved
 *   by whatever renders the document — a site root, not the file's directory —
 *   so loam does not know what it points at;
 * - a PURE fragment (`#section`) addresses this same document, and grading it
 *   means resolving heading anchors, which is a different question from "does
 *   this file exist".
 *
 * The last two are DEFENSIVE rather than decisive, and a mutation run says so:
 * removing either leaves every test green, because a pure fragment leaves an
 * empty path and a site-root target resolves outside the docs repo, where
 * `./findings.ts` declines to answer anyway. They are kept because the reason
 * differs from that boundary's — loam is not silent about these because they
 * are elsewhere, it is silent because it does not know where they are — and a
 * later reader deleting them as dead would be removing an intention, not a
 * branch.
 */
function push(out: DocumentLink[], target: string, text: string, line: number): void {
  const raw = target.startsWith("<") && target.endsWith(">") ? target.slice(1, -1) : target;
  if (raw === "" || raw.startsWith("#") || raw.startsWith("/")) return;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return;
  const path = decodePath(raw.split("#")[0]!);
  if (path === "") return;
  out.push({ raw, path, text, line });
}

/**
 * Percent-decode a link target, or keep it verbatim when it does not decode.
 *
 * `[Order line](order%20line.md)` is how every editor writes a path holding a
 * space, so a resolver that skipped this step would report the one spelling
 * authors do not type by hand. `decodeURIComponent` throws on a lone `%` — a
 * literal percent in a filename is legal and rarer than the escape — and the
 * honest answer there is the string as written, which then resolves or does not
 * on its own terms.
 */
function decodePath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Re-express every relative link in `md` from a new base directory — the merge's
 * half of the link convention.
 *
 * THE DEFECT THIS CLOSES is structural and predates the glossary. A feature's
 * `specs/<svc>/spec.md` sits four directories below the docs root; the living
 * `services/<svc>/spec.md` it merges into sits two. `loam archive` copies a
 * requirement's text verbatim, so `[Order](../../../../glossary/order.md)` —
 * correct where it was written, and clickable in the pull request that reviewed
 * it — lands in the living document pointing two directories above the
 * repository. The same is true of a delta requirement citing an ADR, which has
 * been possible since before this module existed.
 *
 * REWRITING IS THE ONLY ANSWER THAT KEEPS BOTH PROPERTIES. The alternative
 * considered was to have authors write the link relative to where the text will
 * END UP, leaving loam to touch nothing — but that link does not resolve in the
 * delta, and "it renders as a link in pull-request review, which is where these
 * documents are actually read" is the convention's own first argument. So the
 * author writes what is true where they write it, and the merge makes it true
 * where it lands. The target is unchanged: only the route to it is.
 *
 * It is a positional rewrite, never a re-render: the matched target's own span
 * is replaced and every other byte of the line — the link text, the title, the
 * prose around it — is left exactly as written.
 */
export function rebaseLinks(md: string, move: { from: string; to: string }): string {
  const from = resolve(move.from);
  const to = resolve(move.to);
  if (from === to) return md;
  const fenced = fenceTracker();
  // `split` with a capturing group keeps the separators, so a document's own
  // mixture of CRLF and LF survives a rewrite that touches neither.
  const parts = md.split(/(\r?\n)/);
  for (let i = 0; i < parts.length; i += 2) {
    const rawLine = parts[i]!;
    if (fenced(rawLine)) continue;
    parts[i] = rebaseLine(rawLine, from, to);
  }
  return parts.join("");
}

/** One line's links re-expressed, right to left so earlier spans keep their offsets. */
function rebaseLine(rawLine: string, from: string, to: string): string {
  const blanked = rawLine.replace(CODE_SPAN_RE, (m) => " ".repeat(m.length));
  const spans: Array<[number, number, string]> = [];
  const collect = (m: RegExpExecArray): void => {
    const at = m.indices?.[2];
    if (at === undefined) return;
    const rebased = rebaseTarget(m[2]!, from, to);
    if (rebased !== null) spans.push([at[0], at[1], rebased]);
  };
  const definition = DEFINITION_RE.exec(blanked);
  if (definition) collect(definition);
  else {
    INLINE_RE.lastIndex = 0;
    for (let m = INLINE_RE.exec(blanked); m !== null; m = INLINE_RE.exec(blanked)) collect(m);
  }
  let out = rawLine;
  for (const [start, end, replacement] of spans.reverse()) {
    out = out.slice(0, start) + replacement + out.slice(end);
  }
  return out;
}

/**
 * One target, re-expressed from `to` instead of `from`, or null when there is
 * nothing to re-express.
 *
 * The exclusions are `push`'s exactly — an absolute URL, a site-root path and a
 * bare fragment mean the same thing from every directory — and the ANGLE-BRACKET
 * and PERCENT-ESCAPE forms are preserved rather than normalised: a rewrite that
 * silently changed `<a b.md>` into `a%20b.md` would be editing the author's
 * spelling under cover of moving their file.
 */
function rebaseTarget(target: string, from: string, to: string): string | null {
  const angled = target.startsWith("<") && target.endsWith(">");
  const raw = angled ? target.slice(1, -1) : target;
  if (raw === "" || raw.startsWith("#") || raw.startsWith("/")) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return null;
  const hash = raw.indexOf("#");
  const pathPart = hash === -1 ? raw : raw.slice(0, hash);
  const fragment = hash === -1 ? "" : raw.slice(hash);
  if (pathPart === "") return null;
  const encoded = pathPart.includes("%");
  let rebased = relative(to, resolve(from, decodePath(pathPart))).split(sep).join("/");
  // `relative` returns a bare name for a sibling, which markdown reads as a
  // path relative to the file anyway — but `./` is what an author writes and
  // what keeps the link distinguishable from a reference label.
  if (rebased !== "" && !rebased.startsWith(".")) rebased = `./${rebased}`;
  if (rebased === "") return null;
  if (!angled && (encoded || rebased.includes(" "))) rebased = rebased.split(" ").join("%20");
  const rewritten = rebased + fragment;
  return angled ? `<${rewritten}>` : rewritten;
}
