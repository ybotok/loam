/**
 * The joins fleet.yaml states — the operation a `calls:` entry names, and the
 * message a `publishes:` or `consumes:` entry names — read into the edges
 * `loam seed` draws. Split from `./fleet-file.ts` on the subject seam: that
 * module owns the DECLARATIONS (services, subsystems, externals, and the one
 * flat namespace they share); this one owns the STATEMENTS between declared
 * names, which are the only part of the file carrying an id loam later matches,
 * byte for byte, against somebody's contract.
 *
 * Nothing here infers. Every id on the map is a copy of a token a human typed,
 * and every kind is the one the section names: `calls:` draws `-[calls]->` with
 * `metadata { op }`, `publishes:` draws `-[publishes]->` with
 * `metadata { publishes }`, `consumes:` draws `-[delivers]->` with
 * `metadata { consumes }`. The two message sections exist because the arrow
 * alone cannot say which: in a seeded map a broker and an outside producer are
 * both a `softwareSystem #external`, so `svc -> kafka` could be a publish or a
 * consume drawn backwards, and choosing between them is the guess this command
 * exists not to make.
 *
 * Fail-closed like the rest of the reader: a malformed statement refuses with
 * `file:line` before anything is drawn, through the problem kinds fleet-file
 * already maps to stable codes — a join earned no code of its own, because
 * every fix is the existing one (edit the line, re-run).
 *
 * The edge types live in fleet-file beside the `FleetSeed` they are part of;
 * the import back is type-only and erased, so the value graph still points
 * fleet-file → joins → items and nowhere else.
 */
import { isMap } from "yaml";
import type { JoinKey, SeedCall, SeedEdge, SeedFileProblem } from "./fleet-file.js";
import { at, hint, lineOf, listOf, pairOf, stringOf, type SeedCtx } from "./items.js";

/** The sections a join is stated in, in the order they are read. */
const JOIN_SECTIONS = ["calls", "publishes", "consumes"] as const;
type JoinSection = (typeof JOIN_SECTIONS)[number];

/** The metadata key each section's ids are drawn under — the spelling the spine checks read. */
const KEY_OF: Record<JoinSection, JoinKey> = { calls: "op", publishes: "publishes", consumes: "consumes" };

/** The names a statement may join, as fleet-file has already validated them. */
interface DeclaredNames {
  /** Declaration order is kept: it is the did-you-mean pool's order. */
  readonly services: ReadonlySet<string>;
  readonly externals: ReadonlySet<string>;
  readonly subsystems: ReadonlySet<string>;
}

type JoinsRead =
  | { readonly ok: true; readonly calls: readonly SeedCall[]; readonly edges: readonly SeedEdge[] }
  | { readonly ok: false; readonly problem: SeedFileProblem };

/** One id as stated, with the line it was written on (a block list puts each on its own). */
interface StatedId {
  readonly id: string;
  readonly line: number;
}

/** One entry of one section, its shape checked and its endpoints not yet. */
interface Statement {
  readonly section: JoinSection;
  readonly from: string;
  readonly to: string;
  /** The arrow as written, for the sentences. */
  readonly raw: string;
  /** `file:line` of the entry. */
  readonly where: string;
  readonly line: number;
  /** null: a bare `a -> b` under `calls:`, a call whose operation is not named yet. */
  readonly ids: readonly StatedId[] | null;
}

type EntryRead = { readonly statement: Statement } | { readonly invalid: string };

/**
 * A node with no range gives line 0. Unreachable for anything `parseDocument`
 * built — every node it hands back carries one — and 0 reads as "no line"
 * where any other fallback would read as a wrong one.
 */
const NO_LINE = 0;

/** How an entry of each section is written, for the shape refusals. */
const SHAPE: Record<JoinSection, string> = {
  calls: "a call is written 'caller -> callee', or 'caller -> callee: operationId' to name the operation it uses",
  publishes: "a publishes entry is written 'producer -> broker: message'",
  consumes: "a consumes entry is written 'broker -> consumer: message'",
};

/** What an entry of each section may be at all, for an item that is neither a string nor a one-pair mapping. */
const ENTRY: Record<JoinSection, string> = {
  calls:
    "a calls entry is a string 'caller -> callee', or a mapping 'caller -> callee: operationId' that names the " +
    "operation it uses",
  publishes:
    "a publishes entry is a mapping 'producer -> broker: message', as in " +
    "'payment-service -> kafka: payment.PaymentCaptured'",
  consumes:
    "a consumes entry is a mapping 'broker -> consumer: message', as in " +
    "'kafka -> order-service: payment.PaymentAuthorized'",
};

/** One worked example per message section, from the shipped example fleet. */
const MESSAGE_EXAMPLE: Record<Exclude<JoinSection, "calls">, { one: string; list: string }> = {
  publishes: {
    one: "payment-service -> kafka: payment.PaymentCaptured",
    list: "payment-service -> kafka: [payment.PaymentAuthorized, payment.PaymentCaptured]",
  },
  consumes: {
    one: "kafka -> order-service: payment.PaymentAuthorized",
    list: "kafka -> notification-service: [order.OrderPlaced, payment.PaymentCaptured]",
  },
};

function arrowOf(raw: string): { from: string; to: string } | null {
  const m = /^(\S+)\s*->\s*(\S+)$/.exec(raw.trim());
  return m === null ? null : { from: m[1]!, to: m[2]! };
}

/**
 * Why a stated token cannot be an operation or message id, or null. The rule
 * is seed-local and narrower than either contract's: only seed writes a
 * human's token INTO a LikeC4 string, so a quote or backslash would end the
 * string early and the self-check would refuse the fleet as loam's own
 * `internal` bug — and a space or comma is never in an id a contract can
 * match, so it is a typo caught here with its line rather than a
 * `spine.op-undefined` caught a step later without one.
 */
function idHazard(raw: string): string | null {
  if (raw.length === 0) return "an empty id names nothing";
  if (raw.length > 200) return `'${raw.slice(0, 40)}…' is ${raw.length} characters long, and an id here is at most 200`;
  if (/[\s'"`\\,]|\p{Cc}/u.test(raw)) {
    return (
      `'${raw}' cannot be an id here: operation and message ids have no spaces, quotes, backticks, ` +
      `backslashes, commas or control characters (they are matched byte for byte against ` +
      `openapi.yaml's operationId and asyncapi.yaml's message name)`
    );
  }
  return null;
}

/** The ids under one statement's key — one scalar, a flow list or a block list. */
function idsOf(ctx: SeedCtx, value: unknown, s: Omit<Statement, "ids">): { ids: StatedId[] } | { invalid: string } {
  const nodes = listOf(value);
  if (nodes.length === 0) {
    return {
      invalid:
        s.section === "calls"
          ? `${s.where} — '${s.raw}:' names no operation. Write '${s.raw}' for a call whose operation you ` +
            `have not named yet, or name it: '${s.raw}: <operationId>'.`
          : `${s.where} — '${s.raw}:' names no message. Name it: '${s.raw}: <message>', as in ` +
            `'${MESSAGE_EXAMPLE[s.section].one}'.`,
    };
  }
  const ids: StatedId[] = [];
  for (const node of nodes) {
    const id = stringOf(node);
    if (id === null) {
      return {
        invalid:
          s.section === "calls"
            ? `${at(ctx, node)} — an operationId must be a string (quote it if YAML reads it as a number or ` +
              `boolean); a call takes one id or a list: 'a -> b: [createOrder, getOrder]'.`
            : `${at(ctx, node)} — a message name must be a string (quote it if YAML reads it as a number or ` +
              `boolean); a ${s.section} entry takes one name or a list: '${MESSAGE_EXAMPLE[s.section].list}'.`,
      };
    }
    const hazard = idHazard(id);
    if (hazard !== null) return { invalid: `${at(ctx, node)} — ${hazard}.` };
    ids.push({ id, line: lineOf(ctx, node) ?? NO_LINE });
  }
  return { ids };
}

/**
 * One section item: a bare `a -> b` string (a call with no operation — the
 * only form 0.2.0-alpha.18 accepted, and it keeps that meaning), or a mapping
 * of exactly ONE `a -> b` key to its ids.
 */
function joinEntry(ctx: SeedCtx, item: unknown, section: JoinSection): EntryRead {
  const where = at(ctx, item);
  const line = lineOf(ctx, item) ?? NO_LINE;
  const bare = stringOf(item);
  if (bare !== null) {
    const arrow = arrowOf(bare);
    if (arrow === null) return { invalid: `${where} — ${SHAPE[section]} (got '${bare}').` };
    if (section !== "calls") {
      // A message section has no bare form: the whole statement IS the
      // message, and an arrow with none would draw an edge nothing grades.
      return {
        invalid:
          `${where} — a ${section} entry names its message: '${bare.trim()}: <message>', as in ` +
          `'${MESSAGE_EXAMPLE[section].one}'.`,
      };
    }
    return { statement: { section, ...arrow, raw: bare, where, line, ids: null } };
  }
  const pair = isMap(item) ? pairOf(item) : null;
  if (pair === null || (!pair.one && pair.keys.length === 0)) return { invalid: `${where} — ${ENTRY[section]}.` };
  if (!pair.one) {
    return {
      invalid:
        `${where} — one statement per entry: this item holds ${pair.keys.length} ` +
        `(${pair.keys.map((k) => `'${k}'`).join(", ")}); give each its own '- ' line.`,
    };
  }
  const arrow = pair.key === null ? null : arrowOf(pair.key);
  if (pair.key === null || arrow === null) {
    return { invalid: `${at(ctx, pair.keyNode)} — ${SHAPE[section]} (got '${pair.key ?? String(pair.keyNode)}').` };
  }
  const head = { section, ...arrow, raw: pair.key, where, line };
  const ids = idsOf(ctx, pair.value, head);
  if ("invalid" in ids) return ids;
  return { statement: { ...head, ids: ids.ids } };
}

/** The noun a sentence names a statement by — "call" keeps the wording 0.2.0-alpha.18 used. */
function noun(section: JoinSection): string {
  return section === "calls" ? "call" : `${section} entry`;
}

/**
 * Endpoints, self-edges and the consumes direction — everything a statement
 * owes the declarations rather than its own shape.
 */
function statementProblem(s: Statement, names: DeclaredNames): SeedFileProblem | null {
  for (const end of [s.from, s.to]) {
    if (names.services.has(end) || names.externals.has(end)) continue;
    if (names.subsystems.has(end)) {
      return {
        kind: "unknown-endpoint",
        message:
          `${s.where} — ${noun(s.section)} '${s.raw}' names the subsystem '${end}': a subsystem is a place ` +
          `services live, never ${s.section === "calls" ? "a call endpoint" : "an endpoint"}. Name one of its ` +
          `services instead.`,
      };
    }
    return {
      kind: "unknown-endpoint",
      message:
        `${s.where} — ${noun(s.section)} '${s.raw}' names '${end}', which no services: or externals: entry ` +
        `declares.${hint(end, [...names.services, ...names.externals])} Declare it, or fix the spelling, then re-run.`,
    };
  }
  // LikeC4 has no self-edge: it reads `a -> a` as a parent-child
  // relationship and refuses the whole file. Caught HERE, with the line,
  // because the alternative is the self-check refusing `internal` over a
  // fleet file whose fault it is not — and a copy-paste inside a section is
  // exactly how this line gets written.
  if (s.from === s.to) {
    return {
      kind: "invalid",
      message:
        `${s.where} — ${noun(s.section)} '${s.raw}' names '${s.from}' at both ends, and LikeC4 has no ` +
        `self-edge (it reads 'a -> a' as a parent-child relationship). Name the other ` +
        `endpoint, or drop the line.`,
    };
  }
  // The arrow follows the message, so a consumes line's TARGET is the
  // consumer. Pointed at an external it grades nothing at all — the event
  // checks read a consume on the service it lands on, and an external has no
  // asyncapi.yaml here — and says nothing about it either, which is the
  // silent hole this refusal closes (decision D8): the reversed spelling is
  // the natural one to write when the broker is thought of as the subject.
  if (s.section === "consumes" && !names.services.has(s.to)) {
    const ids = (s.ids ?? []).map((i) => i.id);
    const written = ids.length === 1 ? ids.join("") : `[${ids.join(", ")}]`;
    const fix = names.services.has(s.from)
      ? `Write it '${s.to} -> ${s.from}: ${written}'. An outside system consuming a message the fleet sends needs no line.`
      : `A consumes entry's consumer must be a service the fleet declares; an outside system consuming a message needs no line.`;
    return {
      kind: "invalid",
      message:
        `${s.where} — under consumes:, the arrow follows the message to its consumer, and '${s.raw.trim()}' ` +
        `points at ${s.to}, a system outside the fleet, so the line would check nothing. ${fix}`,
    };
  }
  return null;
}

/**
 * What is drawn from the statements, merged the way a repeated `a -> b`
 * always was — silently, because a fact stated twice is still one fact:
 *
 * - an identical (section, from, to, id) is one edge;
 * - a bare call is SUBSUMED — not drawn — when the same ordered pair names an
 *   operation under `calls:`. A bare twin beside a checked HTTP edge is not
 *   harmless: `loam diff` reads every removal from the provider as possibly
 *   still consumed through the edge that names nothing, so the twin would make
 *   every such report carry an "unlinked" doubt the file never stated;
 * - and when the pair states a message with an external at one end. That is
 *   the broker hop 0.2.0-alpha.18 could only draw as a bare call
 *   (`order-service -> kafka`), now said by the `publishes:` or `consumes:`
 *   line, and the bare twin into or out of the broker would be a second
 *   arrow for one fact.
 *
 * A message between two fleet services subsumes nothing. It is not an HTTP
 * edge — the consumer census reads an edge carrying `publishes`/`consumes` as
 * the message half's and never as a caller (core/consumers/consumers.ts) — so
 * the bare call beside it is a second fact, a call whose operation nobody
 * named yet. Dropping it turned the honest "could NOT be fully answered" of a
 * removal into a false "no current edge names it".
 *
 * `calls` stays what `--json` has always counted — the distinct pairs under
 * `calls:`, bare or joined — so every older file keeps its count.
 */
function drawn(statements: readonly Statement[], externals: ReadonlySet<string>): { calls: SeedCall[]; edges: SeedEdge[] } {
  const pairOfStatement = (s: Statement): string => `${s.from} ${s.to}`;
  const subsumesBare = (s: Statement): boolean =>
    s.ids !== null && (s.section === "calls" || externals.has(s.from) || externals.has(s.to));
  const joinedPairs = new Set(statements.filter(subsumesBare).map(pairOfStatement));
  const calls: SeedCall[] = [];
  const edges: SeedEdge[] = [];
  const seenCalls = new Set<string>();
  // Names and ids hold no whitespace (their grammars refuse it), so a
  // space-joined key cannot alias two different edges.
  const seenEdges = new Set<string>();
  for (const s of statements) {
    const pair = pairOfStatement(s);
    if (s.section === "calls" && !seenCalls.has(pair)) {
      seenCalls.add(pair);
      calls.push({ from: s.from, to: s.to });
    }
    if (s.ids === null) {
      if (joinedPairs.has(pair) || seenEdges.has(`bare ${pair}`)) continue;
      seenEdges.add(`bare ${pair}`);
      edges.push({ from: s.from, to: s.to, join: null, line: s.line });
      continue;
    }
    const key = KEY_OF[s.section];
    for (const { id, line } of s.ids) {
      const edgeKey = `${key} ${pair} ${id}`;
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);
      edges.push({ from: s.from, to: s.to, join: { key, id }, line });
    }
  }
  return { calls, edges };
}

/**
 * Read `calls:`, `publishes:` and `consumes:` against the declared names.
 * First problem wins, in section order and then line order, as every other
 * refusal in the file does.
 */
export function readJoins(ctx: SeedCtx, sections: ReadonlyMap<string, unknown>, names: DeclaredNames): JoinsRead {
  const statements: Statement[] = [];
  for (const section of JOIN_SECTIONS) {
    for (const item of listOf(sections.get(section))) {
      const read = joinEntry(ctx, item, section);
      if ("invalid" in read) return { ok: false, problem: { kind: "invalid", message: read.invalid } };
      const problem = statementProblem(read.statement, names);
      if (problem !== null) return { ok: false, problem };
      statements.push(read.statement);
    }
  }
  return { ok: true, ...drawn(statements, names.externals) };
}
