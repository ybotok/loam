/**
 * Turning a name a caller typed into a name loam may join into a path.
 *
 * `servicePaths(docsDir, name)` spells `<docsDir>/services/<name>/`, so an
 * unchecked `name` is caller-controlled path input. Six commands guard it with
 * `assertServiceId` at their boundary; `validate` never did, and both of its
 * entry points — `--service <id>` and the positional `<target>` — reached
 * `servicePaths` with whatever argv held. `--service ../../outside/services/x`
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
import { parseServiceId, type RawServiceId } from "../kernel/ids.js";
import type { FleetContext } from "../fleet-context.js";

export type ServiceTarget =
  | { readonly ok: true; readonly id: RawServiceId }
  | { readonly ok: false; readonly problem: string };

export async function resolveServiceTarget(
  docsDir: string,
  name: string,
  label: string,
  fleet?: FleetContext,
): Promise<ServiceTarget> {
  // The enumeration is asked first, and its answer is the value that travels
  // on: `entry.id` rather than `name`. They are equal as strings, and only one
  // of them carries the fact that a `readdir` produced it.
  const entry = (await listServices(docsDir, fleet)).find((s) => s.id === name);
  if (entry !== undefined) return { ok: true, id: entry.id };
  return parseServiceId(name, label);
}
