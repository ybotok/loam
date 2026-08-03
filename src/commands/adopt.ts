/**
 * `loam adopt` — the bootstrap flow, as a contract with an agent.
 *
 * It emits a BRIEF, not an extraction: the artifacts one service's baseline is
 * made of, the grammar each has to be written in, what the fleet already says
 * about the service, the checks that follow, and the checks that do not exist.
 * The agent reads the code; loam states the work and then judges the result.
 *
 * It writes nothing. A command that produced the documents it is asking for
 * would be doing the half of the job it exists to hand over.
 */
import type { Command } from "commander";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, reportNoConfig } from "../core/json.js";
import { serviceBrief, VIA_ALL, type Brief, type BriefCheck, type BriefTarget } from "../core/brief.js";

interface AdoptOptions {
  service?: string;
  json?: boolean;
}

export function registerAdopt(program: Command): void {
  program
    .command("adopt")
    .description("Brief an agent to write one service's baseline docs from its code, and say what will be checked")
    .option("--service <id>", "service to adopt (defaults to the configured service)")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: AdoptOptions) => {
      const json = opts.json === true;

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }

      const service = opts.service ?? config.service;
      if (service === undefined) {
        fail(json, "invalid-option", "No service. Pass --service <id> or set it in loam.json.");
        return;
      }

      const brief = await serviceBrief(config.docsDir, service);
      if (json) {
        emitJson({ ...brief });
        return;
      }
      render(brief);
    });
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

function render(b: Brief): void {
  console.log(`adopt ${b.service} — write the baseline into ${b.path}/\n`);
  console.log(wrap(b.rule, "  "));

  console.log("\n  artifacts\n");
  const width = Math.max(...b.targets.map((t) => t.artifact.length));
  for (const t of b.targets) {
    const flag = t.exists ? "present" : t.required ? "MISSING" : "missing";
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
  console.log(`    loam vouch --service ${b.service}              # a HUMAN, in the service's own repo`);
  console.log("");
  console.log(
    wrap(
      "Leave everything `status: draft`. Vouching is somebody reading the code and saying the document matches it — it is not yours to do, and a status with no digest behind it is a claim with nothing behind it.",
      "    ",
    ),
  );
}

function printCheck(c: BriefCheck): void {
  console.log(`    ${c.severity === "error" ? "✗" : "⚠"} ${c.code}`);
  console.log(wrap(c.what, "        "));
}

function printShape(t: BriefTarget): void {
  console.log(`\n  ${t.path}${t.exists ? "   (exists — diff, do not replace)" : ""}\n`);
  for (const rule of t.shape) console.log(bullet(rule, "    "));
  if (t.example === undefined) return;
  console.log("");
  for (const line of t.example.trimEnd().split("\n")) console.log(`      ${line}`.trimEnd());
}

function printLandscape(b: Brief): void {
  const l = b.landscape;
  console.log("\n  what the fleet already says about this service\n");
  if (!l.present) {
    console.log("    architecture/landscape.likec4 does not exist yet — nothing to bind to.");
    return;
  }
  if (!l.parses) {
    console.log("    architecture/landscape.likec4 does not parse — bind by hand, and fix it first.");
    return;
  }
  if (l.elements.length === 0) {
    console.log(`    Nothing in the landscape models '${b.service}'.`);
    console.log(
      wrap(
        `Add an element for it, or bind an existing one with metadata { service '${b.service}' }. Until then \`loam validate --all\` reports landscape.service-unmodelled (error) — the fleet map is incomplete.`,
        "    ",
      ),
    );
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
function wrap(text: string, indent: string, width = 88): string {
  const hang = /^\s*-\s/.test(text) ? `${indent}  ` : indent;
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
