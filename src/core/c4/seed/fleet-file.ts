/**
 * fleet.yaml — the tiny human-authored file `loam seed` templates the fleet
 * map from. A human states the facts (which services exist, who calls whom);
 * loam does mechanical templating and guesses nothing, which is what keeps
 * seed on the same side of the no-extractor line as `loam new`.
 *
 * Parsed with the AST (`parseDocument` + `LineCounter`) rather than `parse`,
 * deliberately: every refusal names `file:line`, because the file is edited by
 * hand and "something in it is wrong" is not a fix. Fail-closed throughout —
 * an unknown key, a non-string entry, a malformed call all refuse before the
 * caller writes a single byte; a partially-understood fleet file must never
 * become a partially-right landscape. The node-level readers live in
 * `./items.ts`; this module owns what their answers must amount to.
 *
 * The grammars are the shared ones and never a private copy: service ids
 * through `parseServiceId`, subsystem names through `parseSubsystemName`,
 * externals through the same `dirNameHazard` those two are built on (an
 * external never becomes a directory, but calls name services and externals
 * out of ONE namespace, and a name legal as one and illegal as the other
 * would make the duplicate refusal incoherent — `kernel/ids/service.ts`'s own
 * argument, one level up).
 */
import { isMap, isScalar, LineCounter, parseDocument, type Pair } from "yaml";
import { dirNameHazard, parseServiceId, type ServiceId } from "../../kernel/ids/service.js";
import { parseSubsystemName, type SubsystemName } from "../../kernel/ids/subsystem.js";
import { at, hint, listOf, serviceEntry, stringOf, type SeedCtx } from "./items.js";

export interface SeedService {
  readonly id: ServiceId;
  /** The subsystem this service is filed under, or null for unfiled. */
  readonly subsystem: SubsystemName | null;
}

/** One `a -> b` line. Endpoints are declared names (service ids or externals), not element ids. */
export interface SeedCall {
  readonly from: string;
  readonly to: string;
}

/** The whole fleet file, validated: what the templater renders from. */
export interface FleetSeed {
  readonly services: readonly SeedService[];
  readonly subsystems: readonly SubsystemName[];
  readonly externals: readonly string[];
  readonly calls: readonly SeedCall[];
}

/**
 * Why the file was refused, discriminated by the ACTION the caller takes —
 * each kind maps to one stable error code at the command layer (`invalid` →
 * `seed-file-invalid`, `duplicate` → `seed-duplicate-service`,
 * `unknown-subsystem` → `seed-unknown-subsystem`, `unknown-endpoint` → the
 * existing `unknown-service`, because the fix is the same as for every other
 * unknown service: correct the name and re-run).
 */
export type SeedFileProblem =
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "duplicate"; readonly message: string }
  | { readonly kind: "unknown-subsystem"; readonly message: string }
  | { readonly kind: "unknown-endpoint"; readonly message: string };

export type FleetFileRead =
  | { readonly ok: true; readonly seed: FleetSeed }
  | { readonly ok: false; readonly problem: SeedFileProblem };

const TOP_KEYS = ["services", "subsystems", "externals", "calls"] as const;

function invalid(message: string): FleetFileRead {
  return { ok: false, problem: { kind: "invalid", message } };
}

/** Parse and validate the fleet file's text. Never throws for an expected outcome. */
export function readFleetFile(text: string, file: string): FleetFileRead {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines });
  const ctx: SeedCtx = { file, lines };
  const parseError = doc.errors[0];
  if (parseError !== undefined) {
    const line = parseError.linePos?.[0]?.line;
    return invalid(
      `${file}${line === undefined ? "" : `:${line}`} cannot be read as YAML — ` +
        `${parseError.message.split("\n")[0]!}`,
    );
  }
  if (!isMap(doc.contents)) {
    return invalid(
      `${file} must be a YAML mapping with a \`services:\` list (and optional ` +
        `\`subsystems:\`, \`externals:\`, \`calls:\`) — the whole document is ` +
        `${doc.contents === null ? "empty" : "not a mapping"}.`,
    );
  }

  // The top level, fail-closed: a mistyped key is a whole section silently
  // dropped, which is exactly the partial scaffold this reader must refuse.
  const sections = new Map<string, unknown>();
  for (const pair of doc.contents.items as Pair[]) {
    const key = isScalar(pair.key) && typeof pair.key.value === "string" ? pair.key.value : null;
    if (key === null || !(TOP_KEYS as readonly string[]).includes(key)) {
      const spelled = key ?? String(pair.key);
      return invalid(
        `${at(ctx, pair.key)} — unknown key '${spelled}': the fleet file's keys are ` +
          `services, subsystems, externals and calls.${hint(spelled, TOP_KEYS)}`,
      );
    }
    sections.set(key, pair.value);
  }

  // One flat namespace over everything a name can be declared as, because a
  // call endpoint must name exactly one thing — the same rule the tree walk
  // enforces over `services/` (`subsystem.name-collision`).
  const declared = new Map<string, { where: string; role: string }>();
  const claim = (name: string, where: string, role: string): SeedFileProblem | null => {
    const held = declared.get(name);
    if (held !== undefined) {
      return {
        kind: "duplicate",
        message:
          `${where} declares '${name}' as ${role}, but ${held.where} already declares it as ` +
          `${held.role} — service ids, subsystem names and externals share one flat namespace ` +
          `(a call endpoint must name exactly one thing). Rename or remove one, then re-run.`,
      };
    }
    declared.set(name, { where, role });
    return null;
  };

  const subsystems: SubsystemName[] = [];
  for (const item of listOf(sections.get("subsystems"))) {
    const raw = stringOf(item);
    if (raw === null) return invalid(`${at(ctx, item)} — a subsystems entry must be a string (quote it if YAML reads it as something else).`);
    const parsed = parseSubsystemName(raw, "subsystems entry");
    if (!parsed.ok) return invalid(`${at(ctx, item)} — ${parsed.problem}`);
    const dup = claim(raw, at(ctx, item), "a subsystem");
    if (dup !== null) return { ok: false, problem: dup };
    subsystems.push(parsed.name);
  }

  const services: SeedService[] = [];
  /** Deferred so `subsystem: X` can reference a subsystem declared lower in the file. */
  const subsystemRefs: { id: ServiceId; sub: string; where: string }[] = [];
  for (const item of listOf(sections.get("services"))) {
    const entry = serviceEntry(ctx, item);
    if ("invalid" in entry) return invalid(entry.invalid);
    const parsed = parseServiceId(entry.id, "services entry");
    if (!parsed.ok) return invalid(`${entry.where} — ${parsed.problem}`);
    const dup = claim(entry.id, entry.where, "a service");
    if (dup !== null) return { ok: false, problem: dup };
    if (entry.subsystem !== null) subsystemRefs.push({ id: parsed.id, sub: entry.subsystem, where: entry.where });
    services.push({ id: parsed.id, subsystem: null });
  }
  if (services.length === 0) {
    return invalid(
      `${file} declares no services — \`services:\` is the one required key: list every ` +
        `service id the fleet has (a bare string, or \`{ id, subsystem }\` to file one under a group).`,
    );
  }

  const externals: string[] = [];
  for (const item of listOf(sections.get("externals"))) {
    const raw = stringOf(item);
    if (raw === null) return invalid(`${at(ctx, item)} — an externals entry must be a string (quote it if YAML reads it as something else).`);
    if (dirNameHazard(raw) !== null) {
      return invalid(
        `${at(ctx, item)} — '${raw}' cannot be an external's name: externals share the service-id ` +
          `grammar (start with a letter or digit; letters, digits, '.', '_', '-'; no Windows-reserved ` +
          `names), because calls name services and externals out of one namespace.`,
      );
    }
    const dup = claim(raw, at(ctx, item), "an external");
    if (dup !== null) return { ok: false, problem: dup };
    externals.push(raw);
  }

  // Subsystem references, now that every declaration is in: a `subsystem:`
  // naming nothing is the second-likeliest typo in the file, and the hint
  // offers only names the file really declares.
  const subNames = new Set<string>(subsystems);
  for (const ref of subsystemRefs) {
    if (!subNames.has(ref.sub)) {
      return {
        ok: false,
        problem: {
          kind: "unknown-subsystem",
          message:
            `${ref.where} files service '${ref.id}' under '${ref.sub}', but \`subsystems:\` ` +
            `declares no '${ref.sub}'.${hint(ref.sub, subsystems)} Add it to subsystems:, ` +
            `or fix the spelling, then re-run.`,
        },
      };
    }
  }
  // The branded name comes from the DECLARATION list, never from a second
  // parse of the reference: `subsystems:` is where the grammar ran, and the
  // membership check above proved every reference resolves into it.
  const bySubName = new Map<string, SubsystemName>(subsystems.map((s) => [s as string, s]));
  const filed = new Map(subsystemRefs.map((r) => [r.id as string, bySubName.get(r.sub) ?? null]));
  const seededServices: SeedService[] = services.map((s) => ({
    id: s.id,
    subsystem: filed.get(s.id) ?? null,
  }));

  const endpointProblem = (raw: string, name: string, where: string): SeedFileProblem => {
    if (subNames.has(name)) {
      return {
        kind: "unknown-endpoint",
        message:
          `${where} — call '${raw}' names the subsystem '${name}': a subsystem is a place ` +
          `services live, never a call endpoint. Name one of its services instead.`,
      };
    }
    return {
      kind: "unknown-endpoint",
      message:
        `${where} — call '${raw}' names '${name}', which no services: or externals: entry ` +
        `declares.${hint(name, [...services.map((s) => s.id), ...externals])} Declare it, ` +
        `or fix the spelling, then re-run.`,
    };
  };
  const callable = new Set<string>([...services.map((s) => s.id), ...externals]);
  const calls: SeedCall[] = [];
  const seenCalls = new Set<string>();
  for (const item of listOf(sections.get("calls"))) {
    const raw = stringOf(item);
    if (raw === null) return invalid(`${at(ctx, item)} — a calls entry must be a string of the form 'caller -> callee'.`);
    const m = /^(\S+)\s*->\s*(\S+)$/.exec(raw.trim());
    if (m === null) {
      return invalid(`${at(ctx, item)} — a call is written 'caller -> callee' (got '${raw}').`);
    }
    const [from, to] = [m[1]!, m[2]!];
    for (const end of [from, to]) {
      if (!callable.has(end)) return { ok: false, problem: endpointProblem(raw, end, at(ctx, item)) };
    }
    // LikeC4 has no self-edge: it reads `a -> a` as a parent-child
    // relationship and refuses the whole file. Caught HERE, with the line,
    // because the alternative is the self-check refusing `internal` over a
    // fleet file whose fault it is not — and a copy-paste inside `calls:` is
    // exactly how this line gets written.
    if (from === to) {
      return invalid(
        `${at(ctx, item)} — call '${raw}' names '${from}' at both ends, and LikeC4 has no ` +
          `self-edge (it reads 'a -> a' as a parent-child relationship). Name the other ` +
          `endpoint, or drop the line.`,
      );
    }
    const key = `${from} ${to}`;
    // A repeated line is the same fact stated twice, not a second edge.
    if (seenCalls.has(key)) continue;
    seenCalls.add(key);
    calls.push({ from, to });
  }

  return { ok: true, seed: { services: seededServices, subsystems, externals, calls } };
}
