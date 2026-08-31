import type { Command } from "commander";
import { closeIds } from "../../core/c4/arch.js";
import { loadConfig } from "../../core/envelope/config.js";
import { InvalidIdError, assertServiceId, type PathableService } from "../../core/kernel/ids/service.js";
import { emitJson, fail, NO_SERVICE_MESSAGE, repoPath, reportNoConfig } from "../../core/envelope/json.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { listFleetTree, listServices } from "../../core/repo/repo.js";
import { findInTree, nearestTreeNames } from "../../core/repo/tree/find.js";
import { servicePathsUnder, type ServicePaths } from "../../core/repo/paths.js";
import { serviceBrief, type Brief } from "../../core/brief/brief.js";
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
  subsystem?: string;
  targets?: boolean;
  json?: boolean;
}

/**
 * Where `--subsystem` points the brief: the target directory inside the
 * group for a service that does not exist yet, or nothing — with a warning —
 * for one that already does, because adopt writes nothing and MOVES nothing
 * (`loam subsystem move` is the verb that relocates). An unknown subsystem
 * refuses with close-name hints, exactly as a mistyped service id warns: a
 * typo here would brief a whole baseline into a group nobody has.
 */
async function subsystemTarget(
  docsDir: DocsDir,
  name: string,
  service: PathableService,
  json: boolean,
): Promise<{ at?: ServicePaths; warning?: string } | null> {
  const tree = await listFleetTree(docsDir);
  const hit = findInTree(tree, name);
  if (hit === null) {
    const close = nearestTreeNames(name, tree.subsystems.map((s) => s.name));
    fail(
      json,
      "unknown-target",
      `No subsystem '${name}' in the tree.` +
        (close.length > 0 ? ` Close names: ${close.join(", ")}.` : " `loam subsystem new` creates one; `loam subsystem list` shows what exists."),
    );
    return null;
  }
  if (hit.kind === "service") {
    fail(json, "invalid-option", `--subsystem names the service '${name}' — a service never contains other services.`);
    return null;
  }
  const filed = tree.services.find((s) => s.id === service);
  if (filed !== undefined) {
    return {
      warning:
        `'${service}' already exists at ${repoPath(docsDir, filed.dir)}/ — --subsystem does not move a service ` +
        `(\`loam subsystem move ${service} --into ${name}\` does), so the brief targets its existing directory.`,
    };
  }
  return { at: servicePathsUnder(hit.subsystem.dir, service) };
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

  // "Does the service already exist" is enumeration MEMBERSHIP, not an
  // existsSync of services/<id>/ at the root: a service filed into a subsystem
  // exists wherever the tree walk found it, and the root probe read every
  // filed service as new — the near-miss warning then accused its own name of
  // being a typo. One enumeration answers both this and the near-miss list;
  // a repo that refuses enumeration is a different problem, reported by every
  // other command, and adopt has nothing useful to add to it.
  let known: string[] = [];
  try {
    known = (await listServices(docsDir)).map((s) => s.id);
  } catch (err) {
    if (!(err instanceof DocsRepoUnavailableError)) throw err;
    return warnings;
  }
  if (known.includes(service)) return warnings;
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

/**
 * The half of the brief that is computed from THIS repository, for THIS
 * service — what `--targets` keeps.
 *
 * Everything omitted is a module-level constant: `walk` and `walkClose` are the
 * code-reading order, `frontmatter` the field rules, `checks` the named checks,
 * `unchecked` the statements of what nothing checks, `rule` the never-overwrite
 * instruction. None of them is a function of the service, so a fleet-wide
 * adoption pays for the same bytes once per service — measured on the shipped
 * example fleet, about 23 KB of the 42 KB brief, which is four fifths of what
 * an agent reads and none of what it could not have read once.
 *
 * The keys are picked one by one rather than deleted from a rest — a field
 * added to `Brief` later must land in the DEFAULT payload and stay out of this
 * one until somebody decides it varies by service. Getting that wrong the
 * other way round is how a narrowing flag silently becomes the full brief
 * again.
 */
function narrowed(b: Brief): Pick<Brief, "service" | "docsDir" | "path" | "targets" | "landscape"> {
  return { service: b.service, docsDir: b.docsDir, path: b.path, targets: b.targets, landscape: b.landscape };
}

/**
 * The `full` pointer: the run that carries what `--targets` dropped, and the
 * reason it is worth making.
 *
 * It is REQUIRED in the narrowed envelope, and the second sentence is why. The
 * unchecked list is loam shipping, in the binary, the statements of what no
 * check will ever tell you — the one thing standing between a green
 * `loam validate` and being read as more than it means. Merely leaving it out
 * would not read as "omitted for brevity"; it would read as "there is no such
 * list", which is the failure `src/core/brief/unchecked.ts` exists to prevent
 * and the one promise the brief keeps that no validator supplies. So the
 * narrowed view never hides it — it says how many there are and where to read
 * them.
 *
 * Every count comes off the brief that was just assembled, never off a number
 * typed here: a literal would be correct until the next check is added and
 * wrong silently forever after.
 */
function fullBrief(b: Brief): string {
  return (
    `loam adopt --service ${b.service} --json — everything this view leaves out: the ` +
    `${b.walk.length}-stop code walk, the frontmatter rules, the ${b.checks.length} named checks, ` +
    `and the ${b.unchecked.length} statements of what nothing checks. None of it varies by service, ` +
    `so run it once for the system rather than once per service — but do run it: those ` +
    `${b.unchecked.length} statements are the only place loam says where its checking stops.`
  );
}

export function registerAdopt(program: Command): void {
  program
    .command("adopt")
    .description("Brief an agent to write one service's baseline docs from its code, and say what will be checked")
    .option("--service <id>", "service to adopt (defaults to the configured service)")
    .option("--subsystem <name>", "file the new service's baseline into this subsystem instead of the services/ root")
    .option("--targets", "narrow the brief to what varies by service; the walk, the checks and the unchecked list are omitted, and a `full` field names the run that carries them")
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
      let at: ServicePaths | undefined;
      if (opts.subsystem !== undefined) {
        const target = await subsystemTarget(config.docsDir, opts.subsystem, service, json);
        if (target === null) return;
        at = target.at;
        if (target.warning !== undefined) warnings.push(target.warning);
      }
      const brief = await serviceBrief(config.docsDir, service, at);
      // Computed only under `--targets`, and it is what makes the narrowing
      // legible from inside the payload: a consumer holding `full` knows there
      // is more and what it is, and a consumer without it is holding all of it.
      // The narrowing happens HERE, by omission, so the brief itself is
      // unchanged and every field it can produce still exists.
      const full = opts.targets === true ? fullBrief(brief) : undefined;
      if (json) {
        // Two separate emits rather than one conditional spread: the default
        // payload is a frozen contract, and it must stay the same bytes in the
        // same order whatever this flag grows into.
        if (full !== undefined) {
          emitJson({ command: "adopt", ...narrowed(brief), warnings, full });
          return;
        }
        emitJson({ command: "adopt", ...brief, warnings });
        return;
      }
      render(brief, warnings, full);
    });
}
