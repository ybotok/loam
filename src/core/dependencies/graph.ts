/**
 * The graph arithmetic: which edges exist, which of them form a cycle, and what
 * order the features can be archived in.
 *
 * Kept apart from `./facts.ts` because it knows nothing about requirements or
 * operations — it takes ids and edges. That is what makes the cycle detection
 * and the ordering testable against a graph nobody had to build a fleet for,
 * and it is why `compareIds` sorts every adjacency list: the answer has to be
 * the same on two machines that enumerated the docs tree in different orders.
 */
import { compareIds } from "../repo/entries.js";
import { type DependencyEdge, type DependencyReason } from "./facts.js";

export function compareReasons(a: DependencyReason, b: DependencyReason): number {
  const ak = a.kind === "requirement"
    ? `${a.kind}\0${a.service}\0${a.axis}\0${a.identity}`
    : `${a.kind}\0${a.service}\0${a.operationId}`;
  const bk = b.kind === "requirement"
    ? `${b.kind}\0${b.service}\0${b.axis}\0${b.identity}`
    : `${b.kind}\0${b.service}\0${b.operationId}`;
  return compareIds(ak, bk);
}

export function edgeKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

export function appendReason(
  edges: Map<string, DependencyEdge>,
  from: string,
  to: string,
  reason: DependencyReason,
): void {
  if (from === to) return;
  const key = edgeKey(from, to);
  const edge = edges.get(key) ?? { from, to, reasons: [] };
  const encoded = JSON.stringify(reason);
  if (!edge.reasons.some((item) => JSON.stringify(item) === encoded)) edge.reasons.push(reason);
  edges.set(key, edge);
}

export function stronglyConnected(ids: string[], edges: DependencyEdge[]): string[][] {
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);
  for (const targets of adjacency.values()) targets.sort(compareIds);

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (id: string): void => {
    indices.set(id, nextIndex);
    low.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const target of adjacency.get(id) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id)!, indices.get(target)!));
      }
    }
    if (low.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    component.sort(compareIds);
    const selfLoop = component.length === 1
      && (adjacency.get(component[0]!) ?? []).includes(component[0]!);
    if (component.length > 1 || selfLoop) components.push(component);
  };

  for (const id of [...ids].sort(compareIds)) if (!indices.has(id)) visit(id);
  return components.sort((a, b) => compareIds(a[0]!, b[0]!));
}

export function dependencyFirstOrder(ids: string[], edges: DependencyEdge[]): string[] {
  const deps = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) deps.get(edge.from)?.push(edge.to);
  for (const values of deps.values()) values.sort(compareIds);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const dependency of deps.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const id of [...ids].sort(compareIds)) visit(id);
  return order;
}
