/**
 * The event axis's fleet questions, each read lazily — ../lookups.ts's
 * pattern on the message join.
 *
 * Both reach outside the delta: the consumer scan is a landscape spin-up
 * plus a walk of every other service's living requirements, and the
 * in-flight scan reads every active feature's asyncapi delta. Closures over
 * a cache rather than arguments computed up front, so each is paid only
 * when its question is first asked — but the two prices differ, and the
 * difference is deliberate: the consumer scan is paid only by a feature
 * that actually retires production, while the in-flight scan is paid by ANY
 * feature that declares a message at all, because
 * `asyncapi.message-conflict`'s question ("does an in-flight feature define
 * this elsewhere?") is asked of every healthy declaration — unlike the
 * OpenAPI mirror, whose `definedElsewhere` is reached only inside a breach
 * branch. That standing cost matters most on `archive`'s gate, which runs
 * without a FleetContext, so each read here is a real parse.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadFile, serviceResolver, type LoadedDoc } from "../../c4/likec4.js";
import { type PathableService } from "../../kernel/ids/service.js";
import { featureSpecPaths, landscapePath, SPEC_AXES } from "../../repo/paths.js";
import { enumeratedServiceIds, locateServicePaths } from "../../repo/service-target.js";
import { listFeatures } from "../../repo/repo.js";
import { readAsyncapi } from "../../asyncapi/read.js";
import { parseRequirements } from "../../document/parse.js";
import { type Requirement } from "../../document/spec.js";
import type { FleetContext } from "../../fleet-context.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";

/** What the event checks may ask about the world outside this feature's own files. */
export interface EventLookups {
  /**
   * Living consumers of one message a `service` is retiring: landscape
   * `consumes` edges, and other services' living requirements' `Consumes:`
   * lines (spec.md and arch.spec.md both — the outbox file is the canonical
   * home of an event line). The retiring service itself is excluded from
   * both: its own consumption leaves in the same feature, and counting it
   * would gate every self-consuming producer on its own retirement.
   */
  messageConsumers(service: string, message: string): Promise<string[]>;
  /** The in-flight feature (if any) whose asyncapi delta adds or edits (service, message). */
  messageDefinedElsewhere(service: string, message: string): Promise<string | undefined>;
}

/** The identity of the feature being graded — what the lazy scans exclude. */
export interface EventScope {
  docsDir: DocsDir;
  featureId: string;
}

export function eventLookups(scope: EventScope, context?: FleetContext): EventLookups {
  const { docsDir, featureId } = scope;

  // The enumerated fleet, read once and shared by both halves of the
  // consumer scan — ../lookups.ts's discipline, verbatim.
  let serviceIds: PathableService[] | undefined;
  const enumeratedServices = async (): Promise<PathableService[]> =>
    (serviceIds ??= await enumeratedServiceIds(docsDir, context));

  // Living requirements per service, BOTH axes: `Publishes:`/`Consumes:`
  // live in arch.spec.md at least as often as in spec.md (the outbox
  // requirement), so a scan of spec.md alone would answer "nobody consumes
  // it" over the file most authors use.
  const livingReqs = new Map<string, Requirement[]>();
  const livingRequirements = async (service: PathableService): Promise<Requirement[]> => {
    let reqs = livingReqs.get(service);
    if (reqs === undefined) {
      reqs = [];
      for (const axis of SPEC_AXES) {
        const p = (await locateServicePaths(docsDir, service, context))[axis.key];
        if (!existsSync(p)) continue;
        reqs.push(
          ...(context === undefined
            ? parseRequirements(await readFile(p, "utf8"))
            : await context.readRequirements(p)),
        );
      }
      livingReqs.set(service, reqs);
    }
    return reqs;
  };

  // The landscape half: a `consumes` edge is a consumer somebody drew. The
  // message join is fleet-global (names are not service-scoped), so every
  // edge naming the message counts, whoever its producer is — resolved
  // through the enumerated fleet so a landscape that models CONTAINERS
  // stays visible, ../lookups.ts's edgeConsumers lesson.
  let livingLandscape: LoadedDoc | null | undefined;
  const messageConsumers = async (service: string, message: string): Promise<string[]> => {
    if (livingLandscape === undefined) {
      const path = landscapePath(docsDir);
      livingLandscape = existsSync(path)
        ? context === undefined
          ? await loadFile(path)
          : await context.loadLikeC4(path)
        : null;
    }
    const out: string[] = [];
    // An unreadable landscape proves nothing either way; `landscape.invalid`
    // is validate's finding to make.
    if (livingLandscape !== null && livingLandscape.errors.length === 0) {
      const resolve = serviceResolver(livingLandscape.elements, new Set(await enumeratedServices()));
      for (const r of livingLandscape.relationships) {
        if (r.consumes !== message || resolve(r.target) === service) continue;
        out.push(`edge ${resolve(r.source)} → ${resolve(r.target)}${r.title === undefined ? "" : ` ("${r.title}")`}`);
      }
    }
    for (const other of (await enumeratedServices()).filter((id) => id !== service)) {
      for (const r of await livingRequirements(other)) {
        if (r.consumes.includes(message)) out.push(`${other}'s living requirement '${r.name}'`);
      }
    }
    return out;
  };

  // What OTHER features in flight declare, per (service, message) — the
  // asyncapi mirror of pending.ts's activeOpAdditions, living HERE because
  // it shares this module's laziness and its consumers. Removal markers do
  // not count: a feature retiring a message is not adding it. First feature
  // wins a clash — one name to archive first is enough to make progress.
  let inFlight: Map<string, string> | null = null;
  const messageDefinedElsewhere = async (service: string, message: string): Promise<string | undefined> => {
    if (inFlight === null) {
      inFlight = new Map<string, string>();
      for (const feature of await listFeatures(docsDir, {}, context)) {
        if (feature.id === featureId) continue;
        for (const svc of feature.services) {
          const doc = await readAsyncapi(featureSpecPaths(feature.dir, svc).asyncapi, context);
          for (const m of doc.messages) {
            if (m.remove === true) continue;
            const k = `${svc} ${m.name}`;
            if (!inFlight.has(k)) inFlight.set(k, feature.id);
          }
        }
      }
    }
    return inFlight.get(`${service} ${message}`);
  };

  return { messageConsumers, messageDefinedElsewhere };
}
