import type { Command } from "commander";
import { configOrRefuse, emitJson, fail } from "../../core/envelope/json.js";
import { parseServiceId, type RawServiceId } from "../../core/kernel/ids/service.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { FleetContext } from "../../core/fleet-context.js";
import {
  assembleIntroducedPack,
  assemblePack,
  packHoles,
  type ContextPack,
  type IntroducedPack,
} from "../../core/pack/pack.js";
import { introducingFeatures } from "../../core/projection/introduced.js";
import { nearestIds, type FeatureEntry } from "../../core/repo/entries.js";
import { missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { docsRepoReady, reportDocsRepoError, reportRepositoryUnavailable } from "../policy/gate.js";
import { printPack } from "./print.js";

interface ContextOptions {
  feature?: string;
  json?: boolean;
}

export function registerContext(program: Command): void {
  program
    .command("context")
    .argument("<service>", "service id, e.g. payment-service")
    .description(
      "Assemble one service's docs slice — spec, contracts, edges, permissions, capabilities, and the deltas in flight over it — as one deterministic briefing; writes nothing",
    )
    .option("--feature <FEAT>", "narrow the in-flight section to this one feature")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (serviceArg: string, opts: ContextOptions) => {
      const json = opts.json === true;

      const config = await configOrRefuse(json);
      if (config === null) return;
      const { docsDir } = config;
      // `services`, not `docs`: the pack is a statement about one service in
      // the fleet, and an empty pack read out of a directory that is not a
      // docs repo would say "nothing is documented here" about a repo nobody
      // looked in.
      if (!docsRepoReady(json, docsDir, "services")) return;

      const context = new FleetContext();
      try {
        // The feature is resolved BEFORE the service is looked up (delta's
        // ordering): its refusal is about the flag, and it must not depend on
        // whether the service half of the invocation was right.
        let feature: FeatureEntry | null = null;
        if (opts.feature !== undefined) {
          feature = await resolveFeature(docsDir, opts.feature, "exclude", context);
          if (!feature) {
            fail(json, "unknown-target", await missingFeatureMessage(docsDir, opts.feature, context));
            return;
          }
        }

        // The enumeration answers first and the grammar second —
        // core/repo/service-target.ts's settled order, and the pack is exactly
        // the case its banner argues from: `services/payment service/` is a
        // directory `validate --all` grades and `service.id-invalid` tells the
        // team to rename, so refusing it on the grammar would make the one
        // service loam complains about the one service nobody can be briefed
        // on. The enumerated id is safe to use onward — a readdir produced it,
        // which is `RawServiceId`'s whole provenance. A name that is neither
        // enumerated nor legal is refused before any path is built; a legal
        // name with no directory is `unknown-service`, because a typo must
        // never be indistinguishable from an undocumented service — an EMPTY
        // pack reads as "nothing to know here".
        const entries = await context.listServices(docsDir);
        const entry = entries.find((e) => e.id === serviceArg);
        const assembled: Assembled =
          entry !== undefined
            ? { ok: true, pack: await assemblePack({ docsDir, entry, feature, context }) }
            : await notLivingPack({ docsDir, name: serviceArg, feature, context });
        if (!assembled.ok) {
          fail(json, assembled.code, assembled.message);
          return;
        }
        const { pack } = assembled;
        // A document behind the pack that exists but does not parse empties
        // its section, and an agent loading the pack as a briefing would read
        // that as "nothing here" — the vacuously-green pattern. The output
        // stays as informative as ever (and `ok` stays true under --json: the
        // command ran); the exit code is what stops a pipeline from building
        // on it, so it is set BEFORE the format fork — the guard is about the
        // pack, not about how it is rendered.
        if (packHoles(pack)) process.exitCode = 1;

        if (json) {
          emitJson({ command: "context", docsDir, ...pack });
          return;
        }
        printPack(pack);
      } catch (err) {
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // The assembly is all-or-nothing, like explore's scan: it reads every
        // document the pack quotes, so the honest answer to an unreadable FILE
        // (a directory where a document belongs, bytes that are not UTF-8) is
        // a refusal naming the path, not a briefing with a silent hole in it.
        reportRepositoryUnavailable(json, err, "the pack would be missing a document", docsDir);
      }
    });
}

/** A pack to print, or the refusal that stands in for one. */
type Assembled =
  | { ok: true; pack: ContextPack | IntroducedPack }
  | { ok: false; code: "invalid-option" | "unknown-service"; message: string };

interface NotLivingRequest {
  docsDir: DocsDir;
  /** The argument exactly as typed — the living enumeration did not answer to it. */
  name: string;
  /** What `--feature` resolved to, or null when the flag was not given. */
  feature: FeatureEntry | null;
  context: FleetContext;
}

/**
 * The answer for a name `services/` does not hold: the pack of the service an
 * active feature INTRODUCES, or the refusal.
 *
 * The introducing features are the second enumeration, asked before the
 * grammar for the first one's reason — the name came off a readdir, of the
 * feature's own `specs/`. Refusing it as unknown told the implementer of a NEW
 * service, at step 1 of the implement protocol (`loam context <svc> --feature
 * <FEAT>`), that the service the feature they were handed creates does not
 * exist, while `loam tasks` listed their work for it on the same tree.
 *
 * The briefing is ONE feature's delta, because a service nobody has merged yet
 * is whatever its introducing delta says it is. One introducer is used without
 * a flag; several, with none named, is refused rather than picked — two deltas
 * each describing the same new service differently is a conflict a person
 * resolves, and silently briefing from the first would hide the other.
 */
async function notLivingPack(req: NotLivingRequest): Promise<Assembled> {
  const { docsDir, name, feature, context } = req;
  const introducing = await introducingFeatures(docsDir, name, context);
  const [first] = introducing;
  if (first === undefined) return unknownService(req);
  const ids = introducing.map((f) => f.id).join(", ");
  if (feature !== null && !introducing.some((f) => f.dir === feature.dir)) {
    // A feature that does not introduce the service has nothing to say about
    // it — its projection would be an EMPTY pack, which reads as "nothing to
    // know here" about a service another feature is busy creating.
    return {
      ok: false,
      code: "unknown-service",
      message:
        `No service '${name}' under ${docsDir}/services/, and ${feature.id} does not introduce it — ` +
        `${ids} ${introducing.length === 1 ? "does" : "do"}. Name ${introducing.length === 1 ? "it" : "one"} with --feature ${first.id}.`,
    };
  }
  if (feature === null && introducing.length > 1) {
    return {
      ok: false,
      code: "invalid-option",
      message:
        `'${name}' is not in the living docs yet, and ${ids} each introduce it — ` +
        `name the delta to brief from with --feature <FEAT>.`,
    };
  }
  const chosen = feature ?? first;
  // The chosen feature's own readdir spelling of the name: equal as a string,
  // and the one value here that carries the fact that a directory produced it.
  const service: RawServiceId | undefined = chosen.services.find((s) => s === name);
  if (service === undefined) return unknownService(req);
  const pack = await assembleIntroducedPack({ docsDir, service, feature: chosen, introducedBy: introducing, context });
  return { ok: true, pack };
}

/**
 * The refusal for a name nothing holds — the grammar's, then `unknown-service`
 * with the near misses. The candidates are every service a reader could have
 * meant: the living ones and the ones a feature in flight introduces, since a
 * typo of the second is now a name this command would have briefed.
 */
async function unknownService(req: NotLivingRequest): Promise<Assembled> {
  const { docsDir, name, context } = req;
  const parsed = parseServiceId(name, "service");
  if (!parsed.ok) return { ok: false, code: "invalid-option", message: parsed.problem };
  const [living, active] = await Promise.all([context.listServices(docsDir), context.listFeatures(docsDir)]);
  const known = new Set<string>([...living.map((e) => e.id), ...active.flatMap((f) => f.services)]);
  const near = nearestIds(name, [...known]);
  return {
    ok: false,
    code: "unknown-service",
    message:
      `No service '${name}' under ${docsDir}/services/.` +
      (near.length === 0 ? "" : ` Did you mean ${near.map((n) => `'${n}'`).join(" or ")}?`),
  };
}
