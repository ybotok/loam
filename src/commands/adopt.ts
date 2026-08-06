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
import { existsSync } from "node:fs";
import { closeIds } from "../core/arch.js";
import { loadConfig } from "../core/config.js";
import { InvalidIdError, assertServiceId } from "../core/ids.js";
import { emitJson, fail, NO_SERVICE_MESSAGE, reportNoConfig } from "../core/json.js";
import { DocsRepoUnavailableError, listServices, servicePaths } from "../core/repo.js";
import { SEVERITY_MARK } from "../core/report.js";
import { serviceBrief, VIA_ALL, type Brief, type BriefCheck, type BriefTarget } from "../core/brief.js";
import { docsRepoReady } from "./docs-repo-gate.js";

interface AdoptOptions {
  service?: string;
  json?: boolean;
}

/**
 * What is suspicious about this invocation without being wrong.
 *
 * Adopting a service that has no `services/<id>/` yet is the NORMAL case — it
 * is the whole point of the command — so neither of these can be a refusal.
 * But both used to be silent, and both produce the same outcome: a complete,
 * validating baseline written under a directory name nobody meant. `adopt
 * --service biling-service` briefed a phantom service beside the real
 * `billing-service`, and an agent following the brief created it.
 */
async function invocationWarnings(
  docsDir: string,
  service: string,
  bound: string | undefined,
): Promise<string[]> {
  const warnings: string[] = [];

  if (bound !== undefined && bound !== service) {
    warnings.push(
      `This repository's loam.json declares service '${bound}', but you asked to adopt '${service}'. ` +
        `That is legal — one repo can author another service's baseline — but \`loam vouch\`, ` +
        `\`loam gherkin\` and \`loam verify --service\` all bind to '${bound}' here, so the baseline ` +
        `you write cannot be vouched from this repo. If '${service}' is a typo, fix it; otherwise run ` +
        `adopt from '${service}''s own repository.`,
    );
  }

  if (existsSync(servicePaths(docsDir, service).dir)) return warnings;

  // A near-miss is only computable when the docs repo can be enumerated at all;
  // a repo that refuses enumeration is a different problem, reported by every
  // other command, and adopt has nothing useful to add to it.
  let known: string[] = [];
  try {
    known = (await listServices(docsDir)).map((s) => s.id);
  } catch (err) {
    if (!(err instanceof DocsRepoUnavailableError)) throw err;
    return warnings;
  }
  const close = closeIds(service, known);
  if (close.length > 0) {
    warnings.push(
      `There is no services/${service}/ yet, but the docs repo already has ${close.join(", ")}. ` +
        `If '${service}' is a misspelling of one of those, stop now: an agent following this brief ` +
        `writes a complete, validating baseline for a service that does not exist, and nothing ` +
        `downstream can tell it from a real one. If it really is a new service, this is expected.`,
    );
  }
  return warnings;
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
      // This command writes nothing, but it briefs an agent to write a whole
      // baseline — so a docsDir that does not exist is not a harmless read: it
      // hands over eight target paths under a directory nobody has, at exit 0,
      // with the near-miss warning below silently switched off (listServices
      // throws, `invocationWarnings` swallows it and returns nothing). The same
      // refusal every enumerating command owes; see docs-repo-gate.ts.
      //
      // `docs`, not `services`: a docs repo that has no services/ yet is exactly
      // the repo adopt exists to fill, and refusing there would refuse the
      // command's own first use.
      if (!docsRepoReady(json, config.docsDir, "docs")) return;

      const service = opts.service ?? config.service;
      if (service === undefined) {
        fail(json, "invalid-option", NO_SERVICE_MESSAGE);
        return;
      }
      // The id becomes `services/<id>/` in a shared repo, so it goes through the
      // one grammar before anything interpolates it into a path.
      try {
        assertServiceId(service, opts.service === undefined ? "service (loam.json)" : "--service");
      } catch (err) {
        if (!(err instanceof InvalidIdError)) throw err;
        fail(json, "invalid-option", err.message);
        return;
      }

      const warnings = await invocationWarnings(config.docsDir, service, config.service);
      const brief = await serviceBrief(config.docsDir, service);
      if (json) {
        emitJson({ ...brief, warnings });
        return;
      }
      render(brief, warnings);
    });
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

function render(b: Brief, warnings: string[]): void {
  console.log(`adopt ${b.service} — write the baseline into ${b.path}/\n`);
  // In the header, before the work: a warning printed after eight artifact
  // shapes is a warning read after the agent has started writing.
  for (const w of warnings) {
    console.log(wrap(`! ${w}`, "  "));
    console.log("");
  }
  console.log(wrap(b.rule, "  "));

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
