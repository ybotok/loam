import type { Command } from "commander";
import { existsSync } from "node:fs";
import { closeIds } from "../../core/c4/arch.js";
import { loadConfig } from "../../core/envelope/config.js";
import { InvalidIdError, assertServiceId, type PathableService } from "../../core/kernel/ids/service.js";
import { emitJson, fail, NO_SERVICE_MESSAGE, reportNoConfig } from "../../core/envelope/json.js";
import { servicePaths } from "../../core/repo/paths.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { listServices } from "../../core/repo/repo.js";
import { serviceBrief } from "../../core/brief/brief.js";
import { docsRepoReady } from "../policy/gate.js";
import { render } from "./render.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";

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
  docsDir: DocsDir,
  service: PathableService,
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

      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
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
