/**
 * `loam seed` — the fleet map's first hour, mechanically: a tiny
 * human-authored fleet.yaml (service ids, optional subsystems, externals and
 * `a -> b` calls) templated into architecture/landscape.likec4 plus one
 * services/<id>/ directory per service, in one journaled transaction.
 *
 * NOT an extractor, deliberately: a human stated every fact in the file —
 * which services exist and who calls whom is the one thing no generator can
 * read off a repository (core/docs.ts's landscape doctrine) — and loam does
 * mechanical templating over those statements, the same category as
 * `loam new`. Seed never overwrites human work: it writes the landscape only
 * when the file is absent, is the scaffold's untouched stub, or carries its
 * own verified line-1 stamp (`core/c4/seed/stamp.ts`); everything else
 * refuses `seed-landscape-edited`.
 */
import type { Command } from "commander";
import { resolve } from "node:path";
import { loadSource } from "../../core/c4/likec4.js";
import { readFleetFile, type SeedFileProblem } from "../../core/c4/seed/fleet-file.js";
import { sealLandscape } from "../../core/c4/seed/stamp.js";
import { renderLandscape } from "../../core/c4/seed/template.js";
import { loadConfig } from "../../core/envelope/config.js";
import { emitJson, emitJsonError, fail, repoPath, reportNoConfig } from "../../core/envelope/json.js";
import { NotUtf8Error, readUtf8 } from "../../core/staging/writes.js";
import { sayRecovered } from "../policy/format.js";
import { docsRepoReady, reportDocsRepoError } from "../policy/gate.js";
import { serviceTreePathOf } from "../../core/repo/service-target.js";
import { commitSeed, type LandscapeDisposition, type SeedCommit } from "./commit.js";

interface SeedOptions {
  from?: string;
  json?: boolean;
}

export function registerSeed(program: Command): void {
  program
    .command("seed")
    .description(
      "Template the fleet map and service directories from a tiny human-authored fleet.yaml",
    )
    .option("--from <file>", "the fleet file to read (default: fleet.yaml in the current directory)")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: SeedOptions) => {
      const json = opts.json === true;
      const fromArg = opts.from ?? "fleet.yaml";

      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const { docsDir } = loaded.config;
      // `services`, not `docs`: every id in fleet.yaml becomes a
      // services/<id>/ directory, and the under-lock preflight enumerates the
      // tree — a run without the directory that IS the fleet is guessing.
      if (!docsRepoReady(json, docsDir, "services")) return;

      // The fleet file is INPUT only — read once, from wherever the caller
      // keeps it (it may legitimately live outside both repos), never stored
      // and never written back. Refusals name the spelling the caller typed.
      let text: string;
      try {
        text = await readUtf8(resolve(fromArg));
      } catch (err) {
        if (err instanceof NotUtf8Error) return fail(json, "seed-file-invalid", err.message);
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") {
          return fail(
            json,
            "seed-file-invalid",
            `${fromArg} does not exist — write the fleet file (a services: list of ids, plus ` +
              `optional subsystems:, externals: and calls: like 'checkout -> payments'), or ` +
              `point --from at where it lives. Nothing was written.`,
          );
        }
        // An errno is a filesystem answer (EISDIR, EACCES, …) about the named
        // file; anything without one is a real bug and stays `internal`.
        if (e.path !== undefined || typeof e.errno === "number") {
          return fail(
            json,
            "seed-file-invalid",
            `${fromArg} could not be read as the fleet file — ${e.message}. Nothing was written.`,
          );
        }
        throw err;
      }

      const read = readFleetFile(text, fromArg);
      if (!read.ok) return refuseFleetFile(json, read.problem);
      const seed = read.seed;

      // The self-check: the emitted DSL is parsed in memory BEFORE anything
      // is written, so a templater bug can never land as a broken landscape.
      // Its parsed elements are reused for the generated views join.
      const sealed = sealLandscape(renderLandscape(seed));
      const doc = await loadSource(sealed);
      const firstError = doc.errors[0];
      if (firstError !== undefined) {
        return fail(
          json,
          "internal",
          `loam's own templater produced a landscape that does not parse — a bug in loam, not ` +
            `in ${fromArg}; nothing was written. First error: ${firstError.message}`,
        );
      }

      const committed = await commitSeed({
        docsDir,
        seed,
        landscape: sealed,
        elements: doc.elements,
        rerun: `loam seed --from ${fromArg}`,
      });
      if (!committed.ok) return refuseCommit(json, committed);

      const written = committed.written.map((w) => repoPath(docsDir, w));
      const removed = committed.removed.map((w) => repoPath(docsDir, w));
      const firstCreated = committed.services.created[0];
      const next = [
        "loam validate --all",
        "loam list --needs-work",
        // Interpolation is agent-safe: the id already passed the grammar.
        ...(firstCreated === undefined ? [] : [`loam adopt --service ${firstCreated}`]),
      ];

      if (json) {
        emitJson({
          command: "seed",
          fleetFile: fromArg,
          landscape: committed.landscape,
          created: written,
          removed,
          services: committed.services,
          subsystems: [...seed.subsystems].sort(),
          externals: [...seed.externals].sort(),
          calls: seed.calls.length,
          next,
          ...(committed.recovered === null ? {} : { recovered: committed.recovered }),
        });
        return;
      }
      if (committed.recovered !== null && committed.recovered.outcome !== "consistent") {
        console.log(`note: ${sayRecovered(committed.recovered)}`);
      }
      console.log(
        `architecture/landscape.likec4 ${LANDSCAPE_SENTENCE[committed.landscape]} — ` +
          `${seed.services.length} service(s), ${seed.calls.length} call(s), from ${fromArg}`,
      );
      for (const w of written) console.log(`  + ${w}`);
      // Only ever the generated views file, and only when the resulting tree
      // has no subsystems left to view — but a removal printed as `+` would be
      // a lie, and an unmentioned one a surprise in `git status`.
      for (const w of removed) console.log(`  - ${w} (generated, and this tree has no subsystems)`);
      for (const id of committed.services.existing) {
        // Spelled from the enumeration, and this line is the one place it matters
        // most: the sentence is ABOUT placement, so naming the root form would
        // say "left exactly where it is" while pointing at somewhere it is not.
        const at = await serviceTreePathOf(docsDir, id);
        console.log(
          `  = ${at}/ already exists — left exactly where it is (fleet.yaml's ` +
            `placement is ignored for an existing service; \`loam subsystem move ${id} ` +
            `--into <name>\` is how one moves)`,
        );
      }
      console.log("\nNext:");
      for (const n of next) console.log(`  ${n}`);
    });
}

const LANDSCAPE_SENTENCE: Record<LandscapeDisposition, string> = {
  created: "created",
  "replaced-stub": "written (replaced the scaffold's untouched stub)",
  regenerated: "regenerated (the line-1 stamp proved no hand edits)",
};

/** One stable code per problem kind — the mapping the fleet-file union exists for. */
function refuseFleetFile(json: boolean, problem: SeedFileProblem): void {
  switch (problem.kind) {
    case "invalid":
      return fail(json, "seed-file-invalid", problem.message);
    case "duplicate":
      return fail(json, "seed-duplicate-service", problem.message);
    case "unknown-subsystem":
      return fail(json, "seed-unknown-subsystem", problem.message);
    case "unknown-endpoint":
      // The existing code, not a fifth new one: the caller's action is the
      // same as for every other unknown service — fix the name, re-run.
      return fail(json, "unknown-service", problem.message);
  }
  // Exhaustiveness checked, not assumed, and the branch is genuinely dead:
  // without it a fifth `kind` falls out of the switch printing nothing and
  // leaving `process.exitCode` unset — a refused fleet file exiting 0, which
  // is the worst answer available.
  const unreachable: never = problem;
  throw new Error(`refuseFleetFile: no code for fleet-file problem '${JSON.stringify(unreachable)}'`);
}

function refuseCommit(json: boolean, committed: Exclude<SeedCommit, { ok: true }>): void {
  if ("repoGone" in committed) return reportDocsRepoError(json, committed.repoGone);
  if (committed.code === "seed-file-invalid") {
    // The exact ids to paste ride as data beside the prose, so an agent can
    // repair fleet.yaml without parsing a sentence.
    if (json) {
      emitJsonError("seed-file-invalid", committed.message, {
        missingServices: committed.missingServices,
      });
      return;
    }
    return fail(json, "seed-file-invalid", committed.message);
  }
  return fail(json, committed.code, committed.message);
}
