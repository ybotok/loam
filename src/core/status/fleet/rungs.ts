/**
 * Where one service stands on the adoption ladder, as the fleet form of
 * `loam status` asks it. Two predicates, beside the only two modules that read
 * them (`./fleet.ts`, `./next.ts`); they lived in `../report.ts` among the
 * report's types, which is where the feature report's shape needed the room.
 */
import type { ServiceEntry } from "../../repo/entries.js";

/** Nothing is written down: no living spec at all. Every other absence is partial adoption. */
export function undocumented(s: ServiceEntry): boolean {
  return !s.has.spec;
}

/** A person stamped it — `loam vouch`'s exact postcondition, read back off the frontmatter. */
export function vouched(s: ServiceEntry): boolean {
  return s.status === "verified" && s.sources.stamped;
}
