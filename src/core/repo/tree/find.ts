/**
 * Name resolution over a walked tree — the questions every `loam subsystem`
 * verb asks before it acts: what does this name denote, what sits beneath a
 * subsystem, and which names come close to a miss. One module so `move`,
 * `rm`, `new` and `history` cannot grow four private spellings of "the flat
 * namespace" — the walk already enforces one namespace, and resolution must
 * read it the same way.
 */
import { closeIds } from "../../c4/arch.js";
import type { FleetTree, SubsystemEntry, WalkedService } from "./walk.js";

/** What a name denotes in the tree — a service, a subsystem, or nothing. */
export type TreeHit =
  | { kind: "service"; service: WalkedService }
  | { kind: "subsystem"; subsystem: SubsystemEntry }
  | null;

/**
 * Resolve one name against the flat namespace. Services win a tie on
 * purpose: a tie IS `subsystem.name-collision`, already an error finding,
 * and while it stands the service reading keeps every id-addressed command
 * coherent.
 */
export function findInTree(tree: FleetTree, name: string): TreeHit {
  const service = tree.services.find((s) => s.id === name);
  if (service !== undefined) return { kind: "service", service };
  const subsystem = tree.subsystems.find((s) => s.name === name);
  if (subsystem !== undefined) return { kind: "subsystem", subsystem };
  return null;
}

/** Every name the flat namespace holds — service ids and subsystem names together. */
export function treeNames(tree: FleetTree): string[] {
  return [...tree.services.map((s) => s.id), ...tree.subsystems.map((s) => s.name)];
}

/** The near-miss hints a refusal offers, over whichever pool the verb resolves against. */
export function nearestTreeNames(name: string, pool: string[]): string[] {
  return closeIds(name, pool);
}

/** Is `inner` this subsystem itself, or anywhere beneath it? The move-into-own-subtree refusal. */
export function withinSubsystem(sub: SubsystemEntry, path: string[]): boolean {
  return sub.path.length <= path.length && sub.path.every((name, i) => path[i] === name);
}

/** Services anywhere beneath a subsystem — the transitive membership the views and counts share. */
export function servicesUnder(tree: FleetTree, sub: SubsystemEntry): WalkedService[] {
  return tree.services.filter((s) => sub.path.every((name, i) => s.subsystem[i] === name));
}

/** Child subsystems anywhere beneath one — `rm`'s other half of "empty". */
export function subsystemsUnder(tree: FleetTree, sub: SubsystemEntry): SubsystemEntry[] {
  return tree.subsystems.filter((c) => c !== sub && withinSubsystem(sub, c.path));
}
