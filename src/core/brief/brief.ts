/**
 * The adoption brief: what an agent needs in order to write one service's
 * baseline documentation, and what will be checked when it does.
 *
 * `adopt` was specified for years as "read the code, emit the C4". It is not
 * being built, because it cannot be: nothing deterministic reads a legacy
 * service and says what its architecture MEANS, and a guessed model is worse
 * than no model — everyone downstream has to re-derive it to know whether to
 * believe it.
 *
 * So loam takes the half of the job that IS deterministic. It states the work
 * precisely (which files, in which grammar, bound to which existing elements),
 * it says exactly which checks the result will face, and then it says which
 * checks do not exist — because everything in that last list is honesty no
 * validator will ever supply, and an agent that does not know where the checking
 * stops will assume it never does.
 *
 * Nothing here reads code. `sources` in the frontmatter is the only line that
 * ties the result to a repository, which is why the brief argues for it instead
 * of merely listing it.
 */
import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { PathableService } from "../kernel/ids.js";
import { landscapePath, servicePaths } from "../repo/paths.js";
import { VALIDATE_CHECKS, type BriefCheck } from "./checks.js";
import { UNCHECKED } from "./unchecked.js";
import { landscapeArtifact, landscapeContext, type LandscapeContext } from "./landscape.js";
import { ARTIFACTS, type BriefTarget } from "./targets.js";

/* ------------------------------------------------------------------ */
/* The walk — what to read, in what order, and where each finding lands */
/* ------------------------------------------------------------------ */

export interface WalkStop {
  /** What to open, named as a thing to go and find rather than a file name. */
  where: string;
  /** What to take out of it. */
  find: string;
  /** The artifacts this stop feeds, by `artifact` name from `targets[]`. */
  lands: string[];
}

/**
 * The architecture walk: the order a service is read in, and what each stop is
 * for.
 *
 * The brief said "read the code: entry points, HTTP routes and handlers,
 * published events, config, deploy manifests, tests" — one sentence, six nouns,
 * no order and no landing site. What came back matched the sentence: the HTTP
 * surface documented well, because it is the noun an agent recognises fastest,
 * and the scheduler, the consumer group and the outbox missing entirely. Not
 * because they were judged unimportant — because nothing said to go and look,
 * and every check loam owns is computed from what was written rather than from
 * what is there. `UNCHECKED` has said COMPLETENESS is unverifiable since the
 * beginning; that is an argument for stating the sweep, not for leaving it
 * implied.
 *
 * The order is deliberate and it is not the order a reader browses in. Stops 1
 * and 2 fix the SHAPE of the service — which processes exist at all — before
 * any surface is enumerated, because an agent that starts at the HTTP routes
 * has already concluded the service is an API by the time it meets the
 * scheduler. Everything after them is one surface each.
 *
 * `lands` names artifacts rather than describing them, because the two lists
 * are joined: test/agent-contract.test.ts requires every name here to be a
 * target the same brief hands over, so a stop can never feed a file nobody was
 * asked to write.
 */
export const WALK: WalkStop[] = [
  {
    where: "the build and dependency manifests — pom.xml, build.gradle, package.json, go.mod, requirements.txt, and whatever the repo's own README calls the build",
    find: "what this service is built from, and every client library it links against. A broker client, an HTTP client, a database driver: each one is a dependency that has to appear as an edge or a container later, and this list is the only place they are all named at once. A library whose SEMANTICS decide behaviour — a retry budget, a delivery guarantee, a serialization format — is an arch requirement (arch.spec.md), not a fact to leave in your head.",
    lands: ["model.likec4", "runbook.md", "arch.spec.md"],
  },
  {
    where: "the entry points — main/Application/server bootstrap, the DI or module wiring, and anything the deploy manifests actually start",
    find: "how many PROCESSES this service is, and what each one is. An API, a worker, a scheduler, a consumer — a service that is three of those and documented as one is the most common way a baseline is wrong, and it is wrong in a shape no later check can see.",
    lands: ["model.likec4"],
  },
  {
    where: "the HTTP surface — every route, controller, handler and middleware, counted",
    find: "the operation set, in full. Count them before you write, and say the count in the hand-back: `api.ungoverned` can tell you an operation you WROTE has no requirement, and nothing at all can tell you about the twelve you never wrote down.",
    lands: ["openapi.yaml", "spec.md"],
  },
  {
    where: "the message surface — producers, consumers, listener annotations, topic and queue names, the outbox table and its relay",
    find: "every message this service puts on and takes off the bus, with its direction. The direction is the half that gets lost: a consumer documented as a producer is a contract the whole fleet then joins against backwards.",
    lands: ["asyncapi.yaml", "landscape.likec4"],
  },
  {
    where: "the scheduled and background work — cron entries, timers, retry loops, reconcilers, migrations that run at boot",
    find: "behaviour no request ever triggers. It has requirements like anything else, and it is invisible to every surface above — which is why a baseline written from routes alone describes a service that does half of what it does.",
    lands: ["spec.md", "arch.spec.md"],
  },
  {
    where: "the state — datastores, caches, buckets, and the schema or migration directory that says what is in them",
    find: "what this service OWNS versus what it borrows. Ownership is the fact the C4 is for, and it is the one nobody can reconstruct later from the code without re-reading all of it.",
    lands: ["model.likec4"],
  },
  {
    where: "the outbound calls — HTTP clients, generated stubs, gRPC channels, and the config that says which host each one points at",
    find: "who this service calls, and which operation each call names. These become the fleet map's edges; an edge missing here is a dependency the fleet cannot see, and `loam explore` will under-report the blast radius of every future change to the callee. An edge that only configuration attests is PROVISIONAL until the runtime stop: hold it until the deploy manifests confirm nothing switches that client off.",
    lands: ["landscape.likec4"],
  },
  {
    where: "the runtime — config and env vars, deploy manifests, pipelines, alert rules, dashboards",
    find: "how it is run and what pages whom. Alerts are the honest source for health.yaml: an SLO nobody agreed to is invention, but an alert that already fires is a fact somebody wrote down. Deployment manifests OVERRIDE configuration files, and they usually live in another repository — go and find them before any dependency that only configuration attests goes in the model, and check for an environment variable that disables the feature. A capability switched off at deploy time is not a dependency, however completely the config wires it: delete its edge and container, and record it in runbook.md's 'configured but not a dependency, and why' list. A manifest read from another repository is named in the runbook's prose — never in `sources`, which may only hold paths of this service's own repository. An EFFECTIVE configuration value behaviour depends on — the timeout the chart sets, the flag that switches a code path — is an arch requirement in arch.spec.md, with a Covers: line naming what it decides; loam holds its coverage even though it can never check the value.",
    lands: ["runbook.md", "health.yaml", "arch.spec.md"],
  },
  {
    where: "the tests, integration ones first",
    find: "the behaviours somebody already thought worth pinning, in Given/When/Then form before you write a line. A test suite is the only part of a legacy service that states intent rather than mechanism.",
    lands: ["spec.md", "arch.spec.md"],
  },
];

/**
 * The stop that closes the walk. Separate from `WALK` because it is not a place
 * to go — it is the question asked once the walking is done, and the only
 * defence against a sweep that felt thorough because the parts it covered were
 * covered well.
 */
export const WALK_CLOSE =
  "Then list the directories you did NOT open, and say why for each. `loam validate --service <id>`, run inside the service's own repo, reports the same list back as `sources.unwalked` — it compares your `sources` against the files git tracks. A directory you deliberately skipped is a sentence in the hand-back; a directory you skipped without noticing is the gap this walk exists to find.";

/* ------------------------------------------------------------------ */
/* The frontmatter                                                     */
/* ------------------------------------------------------------------ */

export interface FrontmatterBrief {
  /** Field -> what to write in it. */
  fields: Record<string, string>;
  /** Fields to leave alone entirely. */
  never: string[];
  /** Why `sources` carries the weight. */
  why: string;
}

const FRONTMATTER_BRIEF: FrontmatterBrief = {
  fields: {
    service: "the directory this file lives under, exactly. A mismatch is an error (`frontmatter.field-mismatch`).",
    status:
      "`draft`, always. `verified` is a human's word, stamped by `loam vouch --service <id>` run inside the service's own repo — never written by hand.",
    owner: "the team or person who answers for this service.",
    sources:
      "the paths in THIS SERVICE'S repository you actually read to write the document — files and directories only, a directory covering everything beneath it; glob patterns are refused. Not the paths a reader would expect to have been read.",
  },
  never: ["last_verified", "sources_digest", "content_digest", "sources_files"],
  why:
    "`sources` is the only mechanical tie between this document and the code. Everything else loam checks is internal consistency, and a corpus can agree with itself perfectly while describing nothing that exists. `loam validate`, run inside the service's repo, checks every listed path is still there; `loam vouch` hashes their content so a later `validate` can say the code has moved since anyone read it. Both are worth exactly as much as the list is honest.",
};

export interface Brief {
  service: string;
  /** Absolute docs repo root — the anchor the repo-relative paths hang off. */
  docsDir: string;
  /** Repo-relative path of services/<id>/. */
  path: string;
  targets: BriefTarget[];
  /** The order to read the service in, and what each stop feeds. */
  walk: WalkStop[];
  /** The question the walk ends on — see `WALK_CLOSE`. */
  walkClose: string;
  landscape: LandscapeContext;
  frontmatter: FrontmatterBrief;
  checks: BriefCheck[];
  unchecked: string[];
  /** The one instruction that outranks the rest. */
  rule: string;
}

const NEVER_OVERWRITE =
  "Do not overwrite an artifact that already exists. Read it, diff your findings against it, and report what disagrees — a document somebody wrote is evidence, and replacing it destroys the only copy of what they knew.";

/** Assemble the brief for one service. Reads the docs repo; writes nothing. */
export async function serviceBrief(docsDir: string, service: PathableService): Promise<Brief> {
  const paths = servicePaths(docsDir, service);
  const rel = (abs: string): string => relative(docsDir, abs).split(/[\\/]/).join("/");

  // Read before the artifact loop, not after it: what the fleet already says
  // about this service decides whether it owes an API contract at all.
  const landscape = await landscapeContext(docsDir, service);
  const owesApi = apiExpected(landscape);

  const targets: BriefTarget[] = [];
  for (const { key, ...artifact } of ARTIFACTS) {
    // `adrs/` is a directory, and an empty one is not an existing artifact —
    // reporting it as present would tell the agent to diff against nothing.
    const dir = key === "adrsDir";
    const exists = dir ? await hasMarkdown(paths[key]) : existsSync(paths[key]);
    targets.push({
      ...artifact,
      ...(key === "openapi" ? { required: owesApi } : {}),
      path: dir ? `${rel(paths[key])}/` : rel(paths[key]),
      exists,
      action: exists ? "diff" : "create",
    });
  }

  // The eighth target is the fleet map, and it is conditional: a service the
  // landscape ALREADY resolves an element to owes it nothing, and briefing an
  // edit there would invite an agent to draw a second box for a service that
  // has one. Everything else about the target is unconditional — the file is
  // shared, so `action` is `edit` whenever it exists and `create` only for the
  // very first service of a brand-new docs repo.
  if (landscape.modelled !== true) {
    targets.push({
      ...landscapeArtifact(service, landscape.expects, landscape.present),
      path: rel(landscapePath(docsDir)),
      exists: landscape.present,
      action: landscape.present ? "edit" : "create",
    });
  }

  return {
    service,
    docsDir,
    path: rel(paths.dir),
    targets,
    walk: WALK,
    walkClose: WALK_CLOSE,
    landscape,
    frontmatter: FRONTMATTER_BRIEF,
    checks: VALIDATE_CHECKS,
    unchecked: UNCHECKED,
    rule: NEVER_OVERWRITE,
  };
}

async function hasMarkdown(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false;
  const entries = await readdir(dir, { withFileTypes: true });
  // `statSync` for the symlink case: a Dirent never follows one, so `isFile()`
  // is false for a symlinked ADR and the directory reads as empty (repo.ts's
  // `entryIs` is the same rule for `services/` and `features/`).
  return entries.some((e) => {
    if (!e.name.endsWith(".md")) return false;
    if (e.isFile()) return true;
    if (!e.isSymbolicLink()) return false;
    try {
      return statSync(join(dir, e.name)).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Does the fleet expect an API of this service?
 *
 * The brief marked `openapi.yaml` required unconditionally, and printed the
 * absence as `MISSING` in capitals — while `loam validate` and `loam list`
 * derive the opposite from the same landscape (`service.no-openapi` stays quiet
 * when nothing calls the service, and `list`'s maturity ladder stops demanding
 * a contract). For a UI, a worker or a cron the brief was therefore telling an
 * agent to INVENT an API contract into the source of truth — the one class of
 * guess this whole module exists to refuse, and the one the brief itself names
 * in `openapi.yaml`'s shape rules (`ARTIFACTS`, targets.ts).
 *
 * Positive evidence only, exactly as `list` reads it: a landscape that is
 * absent or does not parse proves nothing about who calls this service, so the
 * contract is still owed. `expects` is the ops on inbound edges, which is
 * `list`'s `called` set seen from one service.
 */
function apiExpected(landscape: LandscapeContext): boolean {
  return !landscape.parses || landscape.expects.length > 0;
}
