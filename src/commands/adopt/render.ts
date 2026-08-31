/**
 * The brief as a person reads it.
 *
 * A module of its own because the brief is the one loam output an agent is
 * expected to FOLLOW rather than parse: `--json` carries the same eight targets,
 * and this decides only how they read. The wrapping matters for that reason —
 * a continuation line indented past its marker cannot be misread as a second
 * bullet, which is what a hand-followed checklist gets wrong first.
 */
import { SEVERITY_MARK } from "../../core/vocabulary/report.js";
import { type Brief } from "../../core/brief/brief.js";
import { VIA_ALL, type BriefCheck } from "../../core/brief/checks.js";
import type { BriefTarget } from "../../core/brief/targets.js";

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/**
 * `full` is the `--targets` pointer — the sentence naming the run that carries
 * the invariant half of the brief. Its PRESENCE is what narrows this view, so
 * the two views cannot disagree about what `--targets` means: exactly the
 * sections `--targets` omits from `--json` are the sections skipped here.
 * `undefined` is the default brief, unchanged byte for byte.
 */
export function render(b: Brief, warnings: string[], full?: string): void {
  console.log(`adopt ${b.service} — write the baseline into ${b.path}/\n`);
  // In the header, before the work: a warning printed after eight artifact
  // shapes is a warning read after the agent has started writing.
  for (const w of warnings) {
    console.log(wrap(`! ${w}`, "  "));
    console.log("");
  }
  if (full === undefined) {
    // First, above even the never-overwrite rule, because the rule is an
    // instruction and this is the answer to "what am I looking at": measured on
    // the example fleet, this view is over 650 lines and 5,600 words to an
    // unpaged terminal, and the two rows that actually orient a person —
    // `model.likec4 create MISSING`, `spec.md create MISSING` — land past line
    // 450, behind four hundred lines of prose. `--json` is explicitly the agent
    // contract, so nothing was served by leaving the human view unintroduced.
    // `--targets` skips it — bullet three describes sections that view omits,
    // and that view has its own pointer for the same job.
    printOrientation(b);
    console.log(wrap(b.rule, "  "));

    // Before the artifact table, because the table is the output and this is the
    // input: an agent that meets the file list first starts writing files.
    printWalk(b);
  }

  console.log("\n  artifacts\n");
  // The legend again, next to the thing it decodes. A reader who scrolls back
  // to the table two hundred lines later arrives at four flags and no key, and
  // the capital/lowercase distinction is invisible to anyone who has to
  // remember it rather than read it.
  console.log(wrap(LEGEND_LINE, "    "));
  console.log("");
  const width = Math.max(...b.targets.map((t) => t.artifact.length));
  for (const t of b.targets) {
    // `edit` is the shared fleet map: the file exists, but "present" would read
    // as "nothing to do here", which is the opposite of why it is on the list.
    const flag = t.action === "edit" ? "UNDRAWN" : t.exists ? "present" : t.required ? "MISSING" : "missing";
    console.log(`    ${t.artifact.padEnd(width)}  ${t.action.padEnd(6)}  ${flag.padEnd(7)}  ${t.purpose}`);
  }

  for (const t of b.targets) printShape(t);

  printLandscape(b);

  if (full === undefined) printChecking(b);
  else {
    // The pointer takes the place of the sections it stands for, in the same
    // position they would have occupied. Anywhere else — a footnote under the
    // closing instructions, say — and it reads as a cross-reference rather
    // than as the notice that this brief is not all of the brief.
    console.log("\n  the rest of the brief\n");
    console.log(wrap(full, "    "));
  }

  console.log("\n  when you are done\n");
  console.log(`    loam validate --service ${b.service} --json    # fix every error`);
  // The fleet run is not a nicety: --service never reports the landscape
  // cross-check, so a baseline can pass the line above with the fleet map
  // never edited at all.
  console.log(`    loam validate --all --json                        # in the docs repo: the fleet map`);
  console.log(`    loam vouch --service ${b.service}              # a HUMAN, in the service's own repo`);
  console.log("");
  console.log(
    wrap(
      "Leave everything `status: draft`. Vouching is somebody reading the code and saying the document matches it — it is not yours to do, and a status with no digest behind it is a claim with nothing behind it.",
      "    ",
    ),
  );
}

/** The table's four flags, compressed to one terminal line for the scroll-back reader. */
const LEGEND_LINE = "MISSING required · missing optional · present diff it · UNDRAWN add to the map";

/**
 * A required target whose work is still outstanding.
 *
 * `!t.exists` alone is the wrong test, and the fleet map is the reason: for
 * every repo after its first service `architecture/landscape.likec4` already
 * exists, so `exists` is true while nothing in it resolves to this boundary —
 * which `loam validate --all` grades `landscape.service-unmodelled`, an ERROR.
 * `action` carries that distinction and nothing else does: `edit` is only ever
 * the undrawn fleet map (see `BriefTarget.action`, core/brief/targets.ts).
 */
function outstanding(t: BriefTarget): boolean {
  return t.required && (!t.exists || t.action === "edit");
}

/**
 * The three sentences that make the rest of the page readable: how much of it
 * is owed, what the table's own convention means, and what the four hundred
 * lines below it are.
 *
 * Every number here is computed from the brief that was just assembled — the
 * outstanding count off `targets`, the section sizes off `walk`, `checks` and
 * `unchecked`. A literal would be right until the next check is added and
 * silently wrong forever after, and this block's whole value is that a reader
 * can trust it instead of scrolling to verify it.
 */
function printOrientation(b: Brief): void {
  const owed = b.targets.filter(outstanding);
  console.log("  read this first\n");

  // What is actually owed, named. The count is the load-bearing half: "some of
  // these are required" is a sentence a reader skips, "three of the nine, and
  // here they are" is one they act on.
  console.log(
    bullet(
      owed.length === 0
        ? `None of the ${String(b.targets.length)} artifacts below is both required and outstanding — every required one is already there. What is left is optional, or an existing document to diff your findings against.`
        : `${String(owed.length)} of the ${String(b.targets.length)} artifacts below ${owed.length === 1 ? "is" : "are"} required and not yet done: ${owed.map((t) => t.artifact).join(", ")}. Everything else in the table is optional, or already written and wants diffing rather than replacing.`,
      "    ",
    ),
  );
  console.log("");

  // The legend, in full. The table prints `MISSING` and `missing` as if the
  // capitals were emphasis; they are the required/optional distinction, and
  // nothing on the page said so. `UNDRAWN` needs more than a gloss — it is the
  // one row that is not this boundary's file at all.
  console.log(
    bullet(
      "The flags in that table: `MISSING` in capitals is required and not there, lowercase `missing` is optional and not there, `present` means the file exists — diff it, never replace it. `UNDRAWN` marks the one row that is not this boundary's own file: `architecture/landscape.likec4` is the whole system's map and already holds every other boundary, so ADD to it rather than rewriting it. Until an element in it resolves to this directory, `loam validate --all` reports `landscape.service-unmodelled` (error).",
      "    ",
    ),
  );
  console.log("");

  // What the rest of the page is, so a reader who stops here still knows what
  // they scrolled past — and where the same content lives for an agent, which
  // is the reader this long body was written for.
  console.log(
    bullet(
      `The rest of this page, in order: the ${String(b.walk.length)}-stop order to read the code in, then the grammar of each artifact — every rule there is one a later check depends on — then the ${String(b.checks.length)} named checks the result will face and the ${String(b.unchecked.length)} statements of what nothing checks. \`loam adopt --service ${b.service} --json\` carries the same targets for an agent, and \`--targets\` narrows that to only the part that varies by boundary.`,
      "    ",
    ),
  );
  console.log("");
}

/**
 * The invariant half: the frontmatter rules, the checks that run, and the
 * checks that do not exist. A function of its own only so `--targets` can skip
 * all three in one place — the three sections are the exact set `--targets`
 * omits from `--json`, and splitting them here is what keeps that a single
 * decision instead of three that can drift apart.
 */
function printChecking(b: Brief): void {
  console.log("\n  frontmatter — on every markdown artifact\n");
  for (const [field, what] of Object.entries(b.frontmatter.fields)) {
    console.log(`    ${field}`);
    console.log(wrap(what, "      "));
  }
  console.log(`\n    never write by hand: ${b.frontmatter.never.join(", ")}`);
  console.log(`\n${wrap(b.frontmatter.why, "    ")}`);

  // Attribution matters here: the fleet cross-check runs under `--all`, and a
  // header promising it to `--service` sent agents chasing a finding that
  // invocation never reports.
  console.log(`\n  what \`loam validate --service ${b.service}\` then checks\n`);
  for (const c of b.checks) {
    if (c.via !== VIA_ALL) printCheck(c);
  }
  console.log(`\n  and what only \`loam validate --all\` surfaces\n`);
  for (const c of b.checks) {
    if (c.via === VIA_ALL) printCheck(c);
  }

  console.log("\n  what nothing checks\n");
  for (const u of b.unchecked) console.log(bullet(u, "    "));
}

/**
 * The walk, numbered. The numbers are the point: an unordered list of nine
 * places to look reads as nine optional suggestions, and the two stops that fix
 * what the service IS have to happen before the surfaces are enumerated.
 */
function printWalk(b: Brief): void {
  console.log("\n  read the code in this order — nothing below is written from anything else\n");
  for (const [i, stop] of b.walk.entries()) {
    // The hang is explicit rather than derived: `wrap` infers one from a leading
    // `- `, and a numbered stop whose second line starts at the number's own
    // column reads as the next stop — which for a list whose ORDER is the point
    // is the one misreading that costs something.
    console.log(wrap(`${String(i + 1)}. ${stop.where}`, "    ", 88, "       "));
    // Two more columns than the stop it belongs to: where-to-look and
    // what-to-take are different sentences, and at one indent the second reads
    // as a continuation of the first.
    console.log(wrap(stop.find, "         "));
    console.log(`         → ${stop.lands.join(", ")}`);
    console.log("");
  }
  console.log(wrap(b.walkClose, "    "));
}

function printCheck(c: BriefCheck): void {
  console.log(`    ${SEVERITY_MARK[c.severity]} ${c.code}`);
  console.log(wrap(c.what, "        "));
}

const ACTION_NOTE: Record<BriefTarget["action"], string> = {
  create: "",
  diff: "   (exists — diff, do not replace)",
  edit: "   (the whole fleet's file — ADD to it, never rewrite it)",
};

function printShape(t: BriefTarget): void {
  console.log(`\n  ${t.path}${ACTION_NOTE[t.action]}\n`);
  for (const rule of t.shape) console.log(bullet(rule, "    "));
  if (t.example === undefined) return;
  console.log("");
  for (const line of t.example.trimEnd().split("\n")) console.log(`      ${line}`.trimEnd());
}

function printLandscape(b: Brief): void {
  const l = b.landscape;
  console.log("\n  what the fleet already says about this service\n");
  // The instruction is the same sentence the JSON carries, printed from the
  // same field — the text view and `--json` cannot drift into briefing two
  // different writes.
  if (!l.present) {
    console.log("    architecture/landscape.likec4 does not exist yet — nothing to bind to.");
    console.log("");
    console.log(wrap(l.instruction ?? "", "    "));
    return;
  }
  if (!l.parses) {
    console.log("    architecture/landscape.likec4 does not parse — bind by hand, and fix it first.");
    console.log("");
    console.log(wrap(l.instruction ?? "", "    "));
    return;
  }
  if (l.elements.length === 0) {
    console.log(`    Nothing in the landscape models '${b.service}'.`);
    console.log("");
    console.log(wrap(l.instruction ?? "", "    "));
    return;
  }
  for (const e of l.elements) {
    const bound = e.bound ? "bound" : "matched by title — bind it";
    console.log(`    ${e.id} = ${e.kind} '${e.title}'   (${bound})`);
  }
  for (const e of l.inbound) console.log(`    ← ${e.from}  ${e.op ?? `"${e.title ?? ""}"`}`);
  for (const e of l.outbound) console.log(`    → ${e.to}  ${e.op ?? `"${e.title ?? ""}"`}`);
  if (l.expects.length > 0) {
    console.log("");
    console.log(
      wrap(
        `openapi.yaml must define ${l.expects.map((o) => `'${o}'`).join(", ")} — the fleet already calls ${l.expects.length === 1 ? "it" : "them"}, and a contract that omits ${l.expects.length === 1 ? "it" : "them"} fails spine.op-undefined the moment it lands.`,
        "    ",
      ),
    );
  }
}

/**
 * Wrap prose so the brief is readable in a terminal. Continuation lines are
 * indented past the marker, so a wrapped bullet cannot be misread as two.
 */
function wrap(text: string, indent: string, width = 88, hangIndent?: string): string {
  const hang = hangIndent ?? (/^\s*-\s/.test(text) ? `${indent}  ` : indent);
  const out: string[] = [];
  let line = indent;
  let pad = indent;
  for (const word of text.trim().split(/\s+/)) {
    if (line.length > pad.length && line.length + 1 + word.length > width) {
      out.push(line);
      pad = hang;
      line = hang + word;
    } else {
      line = line.length > pad.length ? `${line} ${word}` : line + word;
    }
  }
  out.push(line);
  return out.join("\n");
}

/** A bullet, wrapped with its continuation lines hanging under the text. */
function bullet(text: string, indent: string): string {
  return wrap(`- ${text}`, indent);
}
