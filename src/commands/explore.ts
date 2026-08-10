import type { Command } from "commander";
import { loadConfig } from "../core/envelope/config.js";
import { explore, type Exploration, type ExploreService } from "../core/explore.js";
import { FleetContext } from "../core/fleet-context.js";
import { emitJson, fail, reportNoConfig } from "../core/envelope/json.js";
import { featureIdProblem, parseServiceIds } from "../core/kernel/ids.js";
import { DocsRepoUnavailableError } from "../core/repo/repo.js";
import { docsRepoReady, reportDocsRepoError, reportRepositoryUnavailable } from "./docs-repo-gate.js";
import { plural } from "./format.js";

/**
 * The feature id in the suggested command line when `--as` did not say.
 *
 * It has to satisfy the feature-id grammar, because `scaffold` is documented as
 * the literal `loam new` line and AGENTS.md's rule is that an instruction loam
 * prints and loam refuses is a defect. `FEAT-NNN` — the obvious placeholder —
 * is exactly that: `loam new FEAT-NNN` comes back `invalid-option`, so the last
 * line of every default run was a command that could not be run.
 *
 * `FEAT-000` parses and is still unmistakably a placeholder, which buys the
 * property the refusal was standing in for: an agent that pastes it unedited
 * gets a feature called FEAT-000, visible in `loam list` within seconds and
 * deletable with `git rm -r`. A plausible id (FEAT-1) would not be.
 */
const PLACEHOLDER = "FEAT-000";

interface ExploreOptions {
  json?: boolean;
  op?: string[];
  as?: string;
}

export function registerExplore(program: Command): void {
  program
    .command("explore")
    .argument("[service...]", "service ids the change starts from")
    .description("Read the fleet around a change nobody has written down yet — writes nothing")
    .option("--json", "emit the machine contract instead of the human view")
    .option(
      "--op <operationId>",
      "seed from an operation instead of a service; repeatable",
      (value: string, prev: string[] = []) => [...prev, value],
    )
    .option("--as <FEAT>", `feature id for the suggested command line (default: ${PLACEHOLDER})`)
    .action(async (serviceArgs: string[], opts: ExploreOptions) => {
      const json = opts.json === true;
      const services = serviceArgs ?? [];
      const operations = opts.op ?? [];

      // `--as` is interpolated into the `loam new` line this command prints
      // under `next:` and returns as `scaffold`, and `loam-feature` teaches an
      // agent to pass `$1` straight into it. Unchecked, `explore` hands back a
      // command `loam new` then refuses — loam instructing an agent to run
      // something loam rejects, which is the one thing the printed-command
      // guard exists to prevent and the one shape it cannot see, because it
      // reads literal source strings and this line is assembled from argv.
      // Same grammar as `new`'s, from core/kernel/ids.ts, so the two cannot disagree.
      if (opts.as !== undefined) {
        const problem = featureIdProblem(opts.as, "feature id for --as");
        if (problem !== null) {
          fail(json, "invalid-option", problem);
          return;
        }
      }
      if (services.length === 0 && operations.length === 0) {
        fail(
          json,
          "invalid-option",
          "Nothing to explore from. Name at least one service, or pass --op <operationId>. " +
            "`loam list services` is the fleet; `loam show <service>` is one of them.",
        );
        return;
      }

      // Rule 6 in docs/DESIGN.md: a raw argv string that reaches a path join is
      // guarded at the command boundary. Every id here reaches `servicePaths`.
      // Before `loadConfig`, exactly as `loam new` guards its `--touches` list:
      // the grammar is a fact about the argument, not about the repository, so
      // an unusable id should answer the same whether or not you are standing
      // in a wired repo.
      //
      // A seed naming a service that does not EXIST is fine and reported as
      // `unknown` — the feature may be introducing it — but one that could not
      // be a service directory at all is a typo, not an intention.
      const seeds = parseServiceIds(services, "service");
      if (!seeds.ok) {
        fail(json, "invalid-option", seeds.problem);
        return;
      }

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const { docsDir } = config;
      // `services`, not `docs`: every answer here is a statement about the
      // fleet, and an empty ring read out of a directory that is not a docs
      // repo says "nothing calls this service" about a repo nobody looked in.
      if (!docsRepoReady(json, docsDir, "services")) return;

      try {
        const result = await explore({
          docsDir,
          services: seeds.ids,
          operations,
          featureId: opts.as ?? PLACEHOLDER,
          context: new FleetContext(),
        });
        if (json) {
          emitJson({ command: "explore", docsDir, ...result });
          return;
        }
        print(result);
      } catch (err) {
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // The scan is all-or-nothing — it reads every seed's contract to build
        // one table — so the honest answer to an unreadable file is a refusal
        // naming the path, not a ring with a silent hole in it.
        reportRepositoryUnavailable(json, err, "the exploration would be missing a service", docsDir);
      }
    });
}

/* ------------------------------------------------------------------ */

function print(r: Exploration): void {
  if (!r.landscape.present || !r.landscape.parses) {
    // Said first and without hedging: with no readable map there IS no ring,
    // and a reader who takes the empty neighbour list at face value concludes
    // the change is contained when nothing checked that.
    const why = r.landscape.present ? "does not parse" : "does not exist";
    console.log(
      `! architecture/landscape.likec4 ${why} — no neighbour below is derived, and none is missing either\n`,
    );
  }

  for (const s of r.services) {
    console.log(`${s.id}   ${label(s)}`);
    if (!s.known) {
      // Two different facts wear the same absence. A SEED nobody typed by
      // accident is a service the feature introduces; one typed by accident is
      // a typo, and the near-miss list is what separates them. A neighbour is
      // neither — the fleet map drew an edge to something with no
      // `services/<id>/`, which is usually an external system and occasionally
      // a service nobody has adopted. Saying "typo" about that one sends a
      // reader looking for a mistake they did not make.
      const near = r.unknown.find((u) => u.id === s.id)?.nearest ?? [];
      const why =
        s.reason === "seed"
          ? "the feature introduces it, or the id is a typo"
          : "an external system, or a service nobody has adopted";
      console.log(
        `    no services/${s.id}/ — ${why}` +
          (near.length > 0 ? `; closest existing: ${near.join(", ")}` : ""),
      );
    } else {
      if (s.missing.length > 0) console.log(`    missing: ${s.missing.join(", ")}`);
      if (!s.modelled) console.log(`    not in the fleet map — no edge into it can be checked`);
      // Said before `exposes`, and said at all: an unreadable contract exposes
      // an empty list, and printing nothing there reads as "this service offers
      // no endpoints" — the answer that turns a MODIFIED requirement into an
      // ADDED one.
      if (s.openapi.unreadable) {
        console.log(`    ! openapi.yaml does not parse — nothing here lists what ${s.id} exposes`);
        if (s.openapi.error !== undefined) console.log(`      ${s.openapi.error}`);
      } else if (s.operations.length > 0) {
        console.log(`    exposes: ${s.operations.join(", ")}`);
      }
    }
    for (const e of s.inbound) console.log(`    ← ${e.service}${edgeNote(e.op, e.title)}`);
    for (const e of s.outbound) console.log(`    → ${e.service}${edgeNote(e.op, e.title)}`);
    console.log("");
  }

  if (r.unresolvedOperations.length > 0) {
    console.log(
      `! no living contract defines ${r.unresolvedOperations.join(", ")} — ` +
        `the feature is adding ${r.unresolvedOperations.length === 1 ? "it" : "them"}, or the id is wrong\n`,
    );
  }

  if (r.neighbours.length > 0) {
    // The whole point of the command, so it is stated as a question rather than
    // a list: these are candidates for --touches, and loam does not know which
    // of them this change actually touches.
    console.log(
      `${plural(r.neighbours.length, "neighbour")} one hop out: ${r.neighbours.join(", ")}`,
    );
    console.log("  weigh each one — loam knows they are connected, not whether you change them\n");
  }

  if (r.overlaps.length > 0) {
    console.log("already in flight over this ground");
    for (const o of r.overlaps) console.log(`  ${o.feature}  ${o.services.join(", ")}`);
    console.log("  `loam dependencies` says which must archive first, and what no ordering fixes\n");
  }

  console.log(`next: ${r.scaffold}`);
}

function label(s: ExploreService): string {
  const where = s.reason === "seed" ? "seed" : s.reason === "calls-seed" ? "calls a seed" : "called by a seed";
  // `known`, matching the branch in `print` — not `maturity === null`. The two
  // are set together and cannot disagree today, but discriminating on different
  // fields for the same question is how they start to: a reader fixing one
  // branch has no reason to look at the other.
  return s.known ? `${where} · ${s.maturity}` : `${where} · not in the docs repo`;
}

function edgeNote(op: string | null, title: string | null): string {
  if (op !== null) return `  ${op}`;
  return title !== null ? `  "${title}"` : "";
}
