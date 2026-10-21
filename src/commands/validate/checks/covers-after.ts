/**
 * A feature's `Covers:` lines, read in the id space they will LIVE in.
 *
 * Feature scope used to resolve an arch delta's `Covers:` entries against the
 * delta's own elements plus the living landscape (`../arch-coverage.ts`), and
 * living scope resolves them against the service's model plus the map
 * (`../service/specs.ts`). The two spaces are not the same. A delta re-declares
 * the elements its edges attach to wherever its author writes them, so a stub
 * `orderService` the living map nests as `marketplace.orderService` gave the
 * line `Covers: orderService -> notificationService` a match at feature scope
 * and `covers.unknown` the moment the archive landed it — and the
 * `c4.uncovered` hint had recommended exactly that delta id (the real-fleet
 * review, 2026-10-21). The landscape merge splices a stub's NEW children under
 * the living element it binds to, so a child's id changes with its parent's.
 *
 * WHAT SURVIVES, cheapest proof first. A service name survives both scopes —
 * the binding is spliced verbatim — so an entry naming services only is
 * settled without reading anything. So is one the living map and the service's
 * own model already answer. Only an entry that resolved through the delta's own
 * ids is then asked of the map the merge would leave, staged with the
 * archive's own function (`core/c4/project/staged.ts`) and parsed once per
 * feature, lazily: that is a LikeC4 workspace spin, and the clean path never
 * pays it. Where the preview cannot be had — no landscape, a merge the archive
 * refuses, a living document that does not parse — the entry is let stand:
 * those are other findings' to report, and grading a line against a map
 * nobody could read is the cascade `covers.unknown` already refuses
 * (`../service/specs.ts`).
 *
 * The same preview names the post-merge id of a NEW element that stands for
 * no service, which is what a `c4.uncovered` hint must offer for it: an element
 * that IS a service is offered by name, and an edge always by its endpoints'
 * service names, the one spelling that resolves in both scopes.
 */
import type { Elem, LoadedDoc, Rel } from "../../../core/c4/likec4.js";
import { entryResolves, parseCoversEntry, type CoverageScope, type CoversEntry } from "../../../core/c4/arch.js";
import { stageMergedProject } from "../../../core/c4/project/staged.js";
import { elementService, serviceResolver } from "../../../core/c4/resolve/service.js";
import type { Requirement } from "../../../core/document/spec.js";
import type { FleetContext } from "../../../core/fleet-context.js";
import type { DocsDir, FeatureDir } from "../../../core/kernel/ids/dirs.js";
import type { Finding } from "../../../core/vocabulary/report.js";

/** The map the merge would leave, parsed, with its own element→service resolver. */
export interface MergedMap {
  doc: LoadedDoc;
  svcOf: (id: string) => string;
}

/** What the preview is computed from. */
export interface MergeSource {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
  fleet: FleetContext;
  /** The enumerated fleet plus the feature's own services — the resolver's set. */
  known: ReadonlySet<string>;
}

/**
 * The post-merge map, computed at most once and only when asked — `null` when
 * it cannot be had. Pre-routing on purpose (no extending models passed): an
 * addition the archive routes into a service's model keeps the fqn it has on
 * the map, and living scope reads model and map as one corpus, so the
 * pre-routing preview holds every id a `Covers:` line can name after archive.
 */
export function mergedMapOf(source: MergeSource): () => Promise<MergedMap | null> {
  let merged: Promise<MergedMap | null> | undefined;
  return () =>
    (merged ??= (async () => {
      const staged = await stageMergedProject({
        docsDir: source.docsDir,
        featureDir: source.featureDir,
        featureId: source.featureId,
        documents: [],
        load: (path) => source.fleet.loadLikeC4(path),
      });
      return staged.kind === "read" ? { doc: staged.doc, svcOf: serviceResolver(staged.doc.elements, source.known) } : null;
    })());
}

/**
 * The `Covers:` spelling for a new element that still resolves once it is
 * living: the service it stands for, else the id the merge gives it — matched in
 * the preview by kind, title and owning service, and offered only when exactly
 * one element answers. The delta's own id is the fallback, never a guess.
 */
export async function survivingElementCover(
  e: Elem,
  delta: { svcOf: (id: string) => string; known: ReadonlySet<string> },
  merged: () => Promise<MergedMap | null>,
): Promise<string> {
  // An explicit binding is spliced verbatim, and living scope matches an
  // element entry by it (`namesElement`), so it survives whether or not the
  // service has a directory yet; a title only where it names a known service.
  const service = elementService(e);
  if (e.service !== undefined || delta.known.has(service)) return service;
  const map = await merged();
  if (map === null) return e.id;
  const owner = delta.svcOf(e.id);
  const [landed, ...others] = map.doc.elements.filter((m) => m.kind === e.kind && m.title === e.title && map.svcOf(m.id) === owner);
  return landed !== undefined && others.length === 0 ? landed.id : e.id;
}

/** The `Covers:` spelling for a new edge — its endpoints' service names, which both scopes resolve alike. */
export function survivingEdgeCover(r: Rel, svcOf: (id: string) => string): string {
  return `${svcOf(r.source)} -> ${svcOf(r.target)}`;
}

/** One arch delta's lines, and the scopes they are read in. */
export interface DeltaSpelledInput {
  service: string;
  reqs: Requirement[];
  /** The scope feature validation has always used — delta, living map, model where widened, health. */
  featureScope: CoverageScope;
  /** The living map's elements and edges — what the merge keeps whatever it adds. */
  living: { elements: Elem[]; relationships: Rel[] };
  /** The service's own model, read lazily; empty when there is none or it does not read. */
  model: () => Promise<{ elements: Elem[]; relationships: Rel[] }>;
  /** The delta's elements and resolver, for the spelling a finding offers instead. */
  elements: Elem[];
  svcOf: (id: string) => string;
  merged: () => Promise<MergedMap | null>;
}

/** Does every element name this entry spells belong to a service? Then it is settled — names survive the merge. */
function namesServicesOnly(entry: CoversEntry, known: ReadonlySet<string>): boolean {
  if (entry.form === "element") return known.has(entry.id);
  if (entry.form === "edge") return known.has(entry.source) && known.has(entry.target);
  return true;
}

/**
 * `covers.unknown` for the entries feature scope resolves only through the
 * delta's own ids, which the map the merge leaves does not declare. Entries
 * that resolve nowhere are `coversUnknownFindings`' to report, so they are
 * skipped here: one breach, one finding.
 */
export async function deltaSpelledCovers(input: DeltaSpelledInput): Promise<Finding[]> {
  const { service, featureScope } = input;
  const known = featureScope.known ?? new Set<string>();
  const out: Finding[] = [];
  for (const r of input.reqs) {
    if (r.kind === "REMOVED") continue;
    for (const raw of r.covers) {
      const entry = parseCoversEntry(raw);
      if (entry.form !== "element" && entry.form !== "edge") continue;
      if (!entryResolves(entry, featureScope) || namesServicesOnly(entry, known)) continue;
      const model = await input.model();
      const after = (elements: Elem[], relationships: Rel[]): CoverageScope => ({
        ...featureScope,
        elements: [...elements, ...model.elements],
        relationships: [...relationships, ...model.relationships],
      });
      if (entryResolves(entry, after(input.living.elements, input.living.relationships))) continue;
      const map = await input.merged();
      if (map === null || entryResolves(entry, after(map.doc.elements, map.doc.relationships))) continue;
      const declared = entry.form === "element" ? input.elements.find((e) => e.id === entry.id) : undefined;
      const named =
        entry.form === "edge"
          ? `${input.svcOf(entry.source)} -> ${input.svcOf(entry.target)}`
          : declared === undefined
            ? entry.id
            : await survivingElementCover(declared, { svcOf: input.svcOf, known }, input.merged);
      out.push({
        severity: "warn",
        code: "covers.unknown",
        subject: service,
        message:
          `${service}: arch.spec.md: requirement '${r.name}' — Covers: '${raw}' resolves only through this ` +
          `feature's delta.likec4, whose ids are its own spelling: the map this merge leaves declares no such ` +
          `${entry.form === "edge" ? "edge" : "element"}, so the next \`loam validate --all\` reports covers.unknown ` +
          `on it. Name it the way the living map does — '${named}' resolves in both`,
      });
    }
  }
  return out;
}
