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

export function render(b: Brief, warnings: string[]): void {
  console.log(`adopt ${b.service} — write the baseline into ${b.path}/\n`);
  // In the header, before the work: a warning printed after eight artifact
  // shapes is a warning read after the agent has started writing.
  for (const w of warnings) {
    console.log(wrap(`! ${w}`, "  "));
    console.log("");
  }
  console.log(wrap(b.rule, "  "));

  // Before the artifact table, because the table is the output and this is the
  // input: an agent that meets the file list first starts writing files.
  printWalk(b);

  console.log("\n  artifacts\n");
  const width = Math.max(...b.targets.map((t) => t.artifact.length));
  for (const t of b.targets) {
    // `edit` is the shared fleet map: the file exists, but "present" would read
    // as "nothing to do here", which is the opposite of why it is on the list.
    const flag = t.action === "edit" ? "UNDRAWN" : t.exists ? "present" : t.required ? "MISSING" : "missing";
    console.log(`    ${t.artifact.padEnd(width)}  ${t.action.padEnd(6)}  ${flag.padEnd(7)}  ${t.purpose}`);
  }

  for (const t of b.targets) printShape(t);

  printLandscape(b);

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
