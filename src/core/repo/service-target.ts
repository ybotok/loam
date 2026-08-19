/**
 * Turning a name a caller typed into a name loam may join into a path.
 *
 * `unfiledServicePaths(docsDir, name)` spells `<docsDir>/services/<name>/`,
 * and its parameter is `PathableService`: an unchecked name at that call site
 * no longer compiles, and this module is where a name a caller typed EARNS the
 * type. The history is why it exists. Six commands guard their argument with
 * `assertServiceId` at the boundary; `validate` never did, and both of its
 * entry points — `--service <id>` and the positional `<target>` — reached
 * the path builder with whatever argv held. `--service ../../outside/services/x`
 * resolved ABOVE the docs repo, and where a `spec.md` happened to sit there
 * loam opened it, graded it, and reported its frontmatter through `--json`.
 *
 * The grammar alone is not the answer, and this is the whole reason this module
 * exists rather than a call to `assertServiceId`. `services/Payment Service/`
 * is a directory `loam list` shows, `validate --all` grades, and
 * `service.id-invalid` calls an error nobody can fix without a rename — so it
 * is exactly the directory somebody points `validate --service` at. Refusing on
 * the grammar would make the one service loam complains about the one service
 * loam cannot look at.
 *
 * So the enumeration answers first and the grammar answers second:
 *
 *   in `services/`      → the enumeration's OWN id, which is a name loam
 *                         already reads off disk every time it lists the fleet.
 *                         Legal or not, it exists, and joining it lands where
 *                         the directory is.
 *   not there, legal    → the caller's name. Nothing exists yet; the run
 *                         continues and grades it `service.unknown`, with the
 *                         near-miss hints that make a typo diagnosable.
 *   not there, illegal  → refused, before any path is built.
 *
 * `show` and `status` already resolve against the enumeration this way. What
 * they do not do is fall through to the grammar, which is why they answer
 * "no such service" to a name that could never BE a service — a worse sentence
 * for the same input.
 */
import { listServices } from "./repo.js";
import { parseServiceId, type PathableService, type RawServiceId } from "../kernel/ids/service.js";
import type { FleetContext } from "../fleet-context.js";
import type { DocsDir, ServiceDir } from "../kernel/ids/dirs.js";
import { servicePathsAt, unfiledServicePaths, type ServicePaths } from "./paths.js";
import type { ServiceEntry } from "./entries.js";

export type ServiceTarget =
  | { readonly ok: true; readonly id: RawServiceId; readonly dir?: ServiceDir }
  | { readonly ok: false; readonly problem: string };

/**
 * The enumerated services, or the empty list when `services/` cannot be
 * enumerated at all. The swallow is deliberate and spelled ONCE: every
 * repository-aware resolver wants "which services exist" as context, and an
 * unenumerable `services/` is that repository's own diagnosis
 * (`services-missing`), never the asking check's. Six call sites each carried
 * this try/catch in their own spelling before it lived here — which is exactly
 * the shape docs/CODE-STYLE.md warns about: an errno fix lands in one copy and
 * the other five keep the old behaviour. The existence probes that used to ask
 * `existsSync(services/<id>/)` ask membership HERE for the same tolerance:
 * `validate --feature` must run in a docs repo with no `services/` at all,
 * where enumerating is a refusal but "does this service exist" still has the
 * honest answer no.
 */
export async function enumeratedServices(
  docsDir: DocsDir,
  fleet?: FleetContext,
): Promise<ServiceEntry[]> {
  try {
    return await listServices(docsDir, fleet);
  } catch {
    return [];
  }
}

/** The id projection of `enumeratedServices` — most membership asks want only the names. */
export async function enumeratedServiceIds(
  docsDir: DocsDir,
  fleet?: FleetContext,
): Promise<RawServiceId[]> {
  return (await enumeratedServices(docsDir, fleet)).map((s) => s.id);
}

/**
 * The artifact paths of a service wherever it lives: the enumeration's own
 * directory when the id exists anywhere in the tree, the unfiled root
 * spelling otherwise — so an absent service still probes, grades
 * (`service.unknown`) and CREATES exactly as it did when the tree was flat.
 * This is the one bridge the ~40 former `servicePaths` call sites resolve
 * through; a caller that already holds a `ServiceEntry` should spell
 * `servicePathsAt(entry.dir)` directly instead of paying a second lookup.
 */
export async function locateServicePaths(
  docsDir: DocsDir,
  service: PathableService,
  fleet?: FleetContext,
): Promise<ServicePaths> {
  const entry = (await enumeratedServices(docsDir, fleet)).find((s) => s.id === service);
  return entry === undefined ? unfiledServicePaths(docsDir, service) : servicePathsAt(entry.dir);
}

export async function resolveServiceTarget(
  docsDir: DocsDir,
  name: string,
  label: string,
  fleet?: FleetContext,
): Promise<ServiceTarget> {
  // The enumeration is asked first, and its answer is the value that travels
  // on: `entry.id` rather than `name`. They are equal as strings, and only one
  // of them carries the fact that a `readdir` produced it. The resolved `dir`
  // travels too, so a caller that goes on to read artifacts can spell
  // `servicePathsAt(dir)` without a second enumeration; it is absent exactly
  // when the name resolved by grammar alone — nothing exists to point at.
  const entry = (await listServices(docsDir, fleet)).find((s) => s.id === name);
  if (entry !== undefined) return { ok: true, id: entry.id, dir: entry.dir };
  return parseServiceId(name, label);
}

/**
 * The same resolution for a name a DOCUMENT declared — an edge target's
 * `metadata { service '…' }` binding, or its title standing in for one — where
 * the caller needs an answer instead of a refusal: which enumerated directory,
 * if any, does this text name?
 *
 * The enumeration is the fleet's `services/` plus whatever directory names the
 * caller has already read for itself — a feature's own `specs/<svc>/`, the only
 * place a service the feature INTRODUCES has a directory at all. There is
 * deliberately no grammar arm here, in either direction: `services/Payment
 * Service/` keeps resolving for the banner's reason, and a legal-looking name
 * that matches no directory has no living file anywhere, so the caller's
 * business is to grade it absent — never to build a path from it.
 *
 * The index is built on the first ask, not at construction: coherence asks per
 * op-edge and features routinely carry none, so the enumeration only runs once
 * an answer matters. A repo whose `services/` cannot be enumerated resolves
 * only the caller's own names — every living probe would have found nothing
 * there anyway, and `services-missing` is that repository's diagnosis, not
 * this document's.
 */
export function enumeratedServiceIndex(
  docsDir: DocsDir,
  known: readonly RawServiceId[],
  fleet?: FleetContext,
): (name: string) => Promise<RawServiceId | undefined> {
  let index: Map<string, RawServiceId> | undefined;
  return async (name: string): Promise<RawServiceId | undefined> => {
    if (index === undefined) {
      index = new Map<string, RawServiceId>();
      for (const id of known) index.set(id, id);
      try {
        for (const s of await listServices(docsDir, fleet)) index.set(s.id, s.id);
      } catch {
        // The docblock's last paragraph: no enumerable services/ means the
        // fleet half of the index is empty, not that the question is an error.
      }
    }
    return index.get(name);
  };
}
