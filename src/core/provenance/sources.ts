/**
 * The `sources` list: vetting the entries an author wrote — patterns, escapes,
 * missing paths, the refusal vocabulary `loam vouch` and `loam validate` share
 * — and grading the vetted list against the service repo: resolved, unvouched,
 * current, stale, and whether the walk reached the whole repository. Vetting
 * and grading are one doctrine about one field, so they live in one file.
 */
import { existsSync } from "node:fs";
import { listField, stringField, type Frontmatter } from "../document/frontmatter.js";
import type { Finding } from "../vocabulary/report.js";
import { resolveInside } from "../kernel/path-safety.js";
import { decodeSourceIndex, movedSources, sourcesDigest } from "./stamp.js";
import type { SkippedSource } from "./walk.js";
import { gitTrackedFiles } from "./git.js";

export async function sourceFindings(
  fm: Frontmatter,
  service: string,
  label: string,
  repoDir: string | undefined,
): Promise<Finding[]> {
  const sources = listField(fm, "sources");
  if (sources.length === 0) {
    return [
      {
        severity: "warn",
        code: "sources.absent",
        message: `${label} names no sources — nothing ties it to the code, so nothing can tell you when it goes out of date`,
      },
    ];
  }
  // Someone else's repository: the paths describe a tree loam is not standing in.
  if (repoDir === undefined) return [];

  // Before existence: a pattern entry would "not exist" as a literal path, and
  // grading it missing would send the author fixing the wrong thing.
  const patterns = patternSources(sources);
  if (patterns.length > 0) {
    return [
      {
        severity: "error",
        code: "sources.path-missing",
        message: `${label}: ${patterns.length} source(s) are glob patterns — ${patterns.join(", ")}. Patterns are no longer supported: name files or directories (a directory already covers everything beneath it).`,
        details: patterns,
        text: { detailPrefix: "- " },
      },
    ];
  }

  const unsafe = unsafeSources(repoDir, sources);
  if (unsafe.length > 0) {
    return [
      {
        severity: "error",
        code: "sources.path-outside",
        message: `${label}: ${unsafe.length} source(s) escape the service repo — ${unsafe.join(", ")}. Sources must be relative paths contained by this repository, including through symlinks.`,
        details: unsafe,
        text: { detailPrefix: "- " },
      },
    ];
  }

  const missing = missingSources(repoDir, sources);
  if (missing.length > 0) {
    return [
      {
        severity: "error",
        code: "sources.path-missing",
        message: `${label}: ${missing.length} source(s) do not exist — ${missing.join(", ")}`,
        details: missing,
        text: { detailPrefix: "- " },
      },
    ];
  }
  const resolved: Finding = {
    severity: "ok",
    code: "sources.resolved",
    message: `${label}: ${sources.length} source(s) resolve`,
  };

  // The walk happens here rather than inside the staleness branch below, even
  // though only staleness needs the hashes: what the walk REFUSED to follow is
  // a hole in the tie to the code whether or not anybody has vouched yet, and
  // an unvouched service is exactly where a reader is about to decide the
  // sources list is honest.
  const { digest, files, index, skipped } = await sourcesDigest(repoDir, sources);
  const findings: Finding[] = [
    resolved,
    ...skippedFindings(skipped, label),
    ...(await walkFindings(repoDir, files, label)),
  ];

  // The paths are there; the question staleness answers is whether what is AT
  // them is still what somebody read.
  const stamped = stringField(fm, "sources_digest");
  if (stamped === undefined) {
    return [
      ...findings,
      {
        severity: "warn",
        code: "sources.unvouched",
        message: `${label}: no sources_digest — nobody has vouched for this against the code, so nothing can tell you when it goes stale. Run \`loam vouch --service ${service}\`.`,
      },
    ];
  }

  const since = stringField(fm, "last_verified") ?? "it was stamped";
  if (digest === stamped) {
    return [
      ...findings,
      {
        severity: "ok",
        code: "sources.current",
        message: `${label}: sources unchanged since ${since} (${files.length} file(s), digest ${digest})`,
      },
    ];
  }

  // What MOVED, when the stamp recorded enough to say. Repeating the frontmatter's
  // own `sources` entries back at a reader — which is all this finding could do
  // before `sources_files` existed — answers a question nobody asked: they wrote
  // that list, and "one of these five directories changed somehow" is where the
  // search starts, not where it ends.
  const moved = movedSources(decodeSourceIndex(stringField(fm, "sources_files")), index);
  return [
    ...findings,
    {
      // A warning, not an error: the doc may still be right, and only a person
      // can say. What loam knows is that nobody has looked since the code moved.
      severity: "warn",
      code: "sources.stale",
      message: `${label}: sources changed since ${since}${moved.summary} — re-read them and \`loam vouch --service ${service}\``,
      details: moved.paths ?? sources,
      text: { detailPrefix: "- " },
    },
  ];
}

/** The first path segment — the top-level directory, or a root file's own name. */
function topLevel(path: string): string {
  const cut = path.indexOf("/");
  return cut === -1 ? path : path.slice(0, cut);
}

/**
 * Was the service WALKED, or only the part somebody wrote about?
 *
 * Every other check loam owns is computed from the documents, so a corpus can
 * agree with itself perfectly while describing a third of a service — the
 * failure `UNCHECKED` names as COMPLETENESS and then, correctly, declines to
 * grade. This is the one measurement that escapes that circle, because it
 * compares the document's `sources` against the REPOSITORY: a top-level path
 * git tracks and no source reaches into is a part of the service nobody opened.
 *
 * git is the denominator on purpose. The alternative is walking the tree and
 * excluding what does not look like source, which means a hand-maintained list
 * of build directories that is wrong for the first language nobody thought of —
 * and a check that is wrong for a whole ecosystem is a warning that ecosystem
 * learns to ignore. `git ls-files` already answers "what does this repository
 * consider its own", it is the author's own answer, and `node_modules` and
 * `target/` fall out of it for free. Where git cannot answer — not a
 * repository, not installed, a timeout — there is no denominator and therefore
 * no finding: proving nothing and saying nothing is the same doctrine
 * `sources.unverifiable-from-here` follows.
 *
 * TOP-LEVEL granularity, not a percentage threshold. A ratio needs a line
 * drawn somewhere, and an invented threshold is exactly the number this
 * codebase refuses to write into other people's dashboards; a named directory
 * needs no threshold and is answerable — either it holds nothing this document
 * owes, and the hand-back says so in one sentence, or the walk stopped early.
 * The ratio still rides along in the message as a dial, where it informs
 * without grading.
 */
async function walkFindings(repoDir: string, covered: string[], label: string): Promise<Finding[]> {
  const tracked = await gitTrackedFiles(repoDir);
  if (tracked === null || tracked.length === 0) return [];

  // The honest intersection, not "every file under a directory somebody
  // touched": reading one file in src/ does not make the other four hundred
  // read, and a coverage number that says it does is worse than none.
  const coveredSet = new Set(covered);
  const hit = tracked.filter((p) => coveredSet.has(p)).length;
  const ratio = `${String(hit)} of ${String(tracked.length)} tracked file(s)`;

  const touched = new Set(covered.map(topLevel));
  const untouched = [...new Set(tracked.map(topLevel))].filter((t) => !touched.has(t)).sort();
  if (untouched.length === 0) {
    return [
      {
        severity: "ok",
        code: "sources.walked",
        message: `${label}: sources reach into every top-level path this repository tracks (${ratio})`,
      },
    ];
  }
  return [
    {
      severity: "warn",
      code: "sources.unwalked",
      message:
        `${label}: sources cover ${ratio}, and ${String(untouched.length)} top-level path(s) were never opened. ` +
        `Either they hold nothing this document owes — say which, and why, in the hand-back — or the walk stopped early ` +
        `and the baseline describes part of a service.`,
      details: untouched,
      text: { detailPrefix: "- " },
    },
  ];
}

/**
 * The paths the digest walk would not follow. Never silent: a symlink dropped
 * on the floor is a file whose content nobody is watching, while the document
 * beside it says `verified` — the digest cannot go stale over bytes it never
 * hashed, so the one thing the stamp promises is quietly untrue for them.
 *
 * A warning, not an error, and for the same reason staleness is: the doc may be
 * perfectly right about the code behind that link. What loam can say is that it
 * is not watching it.
 */
function skippedFindings(skipped: SkippedSource[], label: string): Finding[] {
  if (skipped.length === 0) return [];
  return [
    {
      severity: "warn",
      code: "sources.skipped",
      message: `${label}: ${skipped.length} path(s) under the listed sources were not hashed — the digest says nothing about what is behind them`,
      details: skipped.map((s) => `${s.path} — ${s.reason}`),
      text: { detailPrefix: "- " },
    },
  ];
}

/** The characters that made an entry a pattern under the glob dialect loam no longer ships. */
const PATTERN_CHARS = /[*?[]/;

/**
 * The `sources` entries that look like glob patterns — anything containing
 * `*`, `?` or `[`. Patterns are refused loudly everywhere sources are consumed
 * (`loam vouch` refuses the run, `loam validate` grades an error), never
 * resolved: the glob dialect loam used to ship silently differed from the
 * gitignore/minimatch conventions authors assume — bracket classes literal,
 * its own `**` handling — so a pattern quietly digested a different file set
 * than intended, corrupting the staleness signal in both directions. A
 * directory already means "everything beneath it", so the fix is to name one.
 *
 * The cost accepted with the rule: a real file with `[` in its name (a Next.js
 * route, say) cannot be listed on its own — its parent directory covers it.
 */
export function patternSources(sources: string[]): string[] {
  return sources.filter((s) => PATTERN_CHARS.test(s.trim()));
}

/** The `sources` entries that resolve to nothing in this repo. */
export function missingSources(repoDir: string, sources: string[]): string[] {
  return sources.filter((s) => !sourceExists(repoDir, s));
}

/** Entries that are absolute, traverse upward, or escape through a symlink. */
export function unsafeSources(repoDir: string, sources: string[]): string[] {
  return sources.filter((source) => {
    const cleaned = source.trim();
    if (cleaned.length === 0) return false;
    try {
      resolveInside(repoDir, cleaned, `source '${source}'`);
      return false;
    } catch {
      return true;
    }
  });
}

/** Does a `sources` entry point at something real? Literal paths only, checked exactly. */
function sourceExists(repoDir: string, source: string): boolean {
  const cleaned = source.trim();
  if (cleaned.length === 0) return false;
  try {
    return existsSync(resolveInside(repoDir, cleaned, `source '${source}'`));
  } catch {
    return false;
  }
}
