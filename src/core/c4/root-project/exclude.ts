/**
 * The ONE literal fact loam reads out of the root `likec4.config.json`: which
 * paths that file excludes from the renderer's root project, and whether a
 * given directory or document is one of them.
 *
 * Until this module existed loam read NOTHING out of that file. It wrote it
 * once (`core/docs.ts`, `loam init --create`), never re-read it, and the team
 * owned it from then on — the ownership rule `core/repo/tree/render/projects.ts`
 * still states for the per-service files. That rule is kept everywhere it still
 * applies; this is the one exception, and it is earned by what report #05
 * measured: a model that EXTENDS the fleet map lives in the ROOT project, so
 * the root's `exclude` decides whether the renderer can see it at all. A repo
 * whose root config still says `services/**` — every repo scaffolded before
 * this axis — renders such a model as a box with nothing inside it, and no
 * check could say why, because nothing here had ever opened the file.
 *
 * READ here, and written back by one command only (`loam subsystem sync`,
 * through `standaloneExclude` in `../service-model/renderer.ts`). Nothing else
 * about the file is interpreted: `exclude` is a glob list in a tool's own
 * config, and the entries loam does not recognise as naming a directory are
 * left exactly where the team put them.
 *
 * IT LIVES BELOW `../project/` BECAUSE THE PROJECT LOADER IS A READER. The
 * architecture document set is the one list every reader shares, and it has to
 * drop a `.likec4` the root project excludes — a palette under an excluded path
 * otherwise yields a `global style` reference the fleet project cannot resolve,
 * `likec4 validate` Invalid on every run and `loam validate --all` at 0 errors
 * (verification 2026-09-04, W5). `../service-model/` already imports
 * `../project/`, so this could not stay there without reversing that edge.
 */
import { readFile } from "node:fs/promises";
import { isRecord } from "../../kernel/records.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import { rootProjectPath } from "../../repo/paths.js";

/** The `services/` prefix every tree path is spelled under, in the config and on disk alike. */
const SERVICES = "services";

/**
 * The root project's `exclude` list, or null when the file cannot be read as a
 * project config at all.
 *
 * The three answers are deliberately distinct, because two of them mean
 * opposite things to a grader:
 *
 *  - `[]` — the file is a JSON object that excludes nothing (or names no
 *    `exclude` key at all, which is the same thing to the renderer). Every
 *    extending model is visible; a standalone one is in the root project where
 *    it cannot parse.
 *  - a list — the entries as written, in file order.
 *  - `null` — absent, unreadable, not JSON, or JSON whose `exclude` is not a
 *    list of strings. loam does not know what the renderer will do, so it says
 *    nothing rather than guessing: the findings that read this list are silent
 *    on null, `subsystem sync` leaves such a file alone, and the project loader
 *    filters nothing. Failing closed here means the team keeps a file loam
 *    cannot parse; failing open would mean loam asserting the renderer excludes
 *    something on evidence it does not have.
 */
export async function readRootExclude(docsDir: DocsDir): Promise<string[] | null> {
  const parsed = await readRootProject(docsDir);
  if (parsed === null) return null;
  const exclude = parsed["exclude"];
  if (exclude === undefined) return [];
  if (!Array.isArray(exclude)) return null;
  // A predicate rather than a cast, so the narrowing below is the compiler's
  // conclusion from a check that actually ran: an `exclude` holding a number is
  // a file loam does not understand, and understanding it half way is how a
  // grader ends up asserting a glob nobody wrote.
  const entries: unknown[] = exclude;
  return entries.every((entry): entry is string => typeof entry === "string") ? [...entries] : null;
}

/**
 * The root project file as a JSON object, or null when it is absent or is not
 * one — the ONE reader, shared with the one writer that re-parses it before a
 * rewrite (`commands/subsystem/txn/exclude.ts`).
 *
 * A LEADING BYTE-ORDER MARK IS STRIPPED, and that is not tidiness: PowerShell's
 * `Out-File` writes `ef bb bf` by default on this platform, so a Windows shell
 * saving the very file loam wrote left `JSON.parse` throwing while the renderer
 * — whose reader tolerates the mark — went on applying every entry in the list.
 * loam then graded nothing at all: `validate --all` silent about an exclusion in
 * full force, `doctor` healthy, `subsystem sync` reporting the list unreadable
 * and naming a fault (`not a JSON object with a string exclude list`) that was
 * not the one present (re-verification 2026-09-04, area C item 3). One reader
 * means the grade and the rewrite can never disagree about whether the file
 * parses.
 */
async function readRootProject(docsDir: DocsDir): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readFile(rootProjectPath(docsDir), "utf8");
  } catch {
    // Absent reads as "loam cannot say", not as "excludes nothing": a docs repo
    // with no root project file has no root project either, and the renderer
    // opened there shows nothing at all — a different problem, with a different
    // finding (`doctor.likec4-config-missing`).
    return null;
  }
  return parseRootProject(text);
}

/** The byte-order mark PowerShell's `Out-File` prepends by default on this platform. */
const BOM = "﻿";

/** The same parse, over bytes a caller already read. Exported for the rewrite path only. */
export function parseRootProject(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.startsWith(BOM) ? text.slice(BOM.length) : text);
  } catch {
    // Not JSON is the team's file to fix, and nothing here may rewrite it.
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

/** A PATH as segments — `/` or `\`, either spelling, no empty parts, no `.`. Never an ENTRY: see `rendererEntry`. */
function segments(path: string): string[] {
  return path.split(/[\\/]/).filter((s) => s.length > 0 && s !== ".");
}

/**
 * One `exclude` entry as the RENDERER will match it — the glob with the
 * spellings that mean nothing to it taken out — or null when the entry can hide
 * nothing loam is able to spell.
 *
 * WHY IT EXISTS. Every matcher below used to build its expression from the entry
 * exactly as written while normalising only the PATH, so four spellings of one
 * line disagreed with the renderer in loam's favour: `./architecture/palette.likec4`,
 * `architecture/./palette.likec4` and `architecture//palette.likec4` each hid the
 * palette from `likec4 validate` (8 source files, down from 9) and from nothing
 * in loam — the census loaded it, `subsystem sync` wrote a `global style
 * subsystems` line naming a group the fleet project cannot resolve, and the run
 * reported 0 errors while every render was Invalid. `./architecture/**` did the
 * same to the whole map with `landscape.excluded` silent (re-verification
 * 2026-09-04, area C items 1-2).
 *
 * MEASURED, at the 1.59.2 pin, against the renderer's own matcher — likec4
 * builds `withoutDoubleSlashes(joinRelativeURL(<project folder>, entry))` (a
 * doubled star and a slash joined in front unless the entry already leads with
 * one or is spelled relative) and hands it to picomatch with `contains: true,
 * dot: true`. The rules that fall out, each pinned in
 * `test/root-exclude.test.ts` against a `npx likec4 validate .` file count:
 *
 *  - a leading `./` is resolved, and it ANCHORS the entry at the docs root —
 *    the any-directories prefix is not added, so `./architecture/**` is about that one
 *    directory and `architecture/**` is about one at any depth;
 *  - `/./` and `//` inside the entry collapse (`architecture//palette.likec4`
 *    hides the palette exactly as the plain spelling does);
 *  - a TRAILING `/` does not: `architecture` hides `architecture-old/old.likec4`
 *    as a raw prefix and `architecture/` does not (measured 5 files vs 6), so
 *    the slash is kept rather than stripped;
 *  - `.//` keeps a literal `.` directory in the pattern and matches NOTHING
 *    (measured: 10 files of 10);
 *  - a BACKSLASH is a literal character to picomatch, never a separator, so
 *    `services\order-service\**` hides nothing at all (measured: 8 files of 8)
 *    — loam used to read it as covering the tree, warn `service.model-excluded`
 *    about a service the renderer loads perfectly well, and then DELETE the
 *    team's line on the next `subsystem sync`.
 *
 * The two arms that answer null are the entries loam declines to reason about:
 * a backslash-bearing one (it covers nothing, so nothing may be graded on it)
 * and one whose `..` walks above the docs root, where the renderer's pattern
 * stops describing this tree at all.
 */
interface RendererEntry {
  /** The glob, `/`-separated, `.` segments resolved and `//` collapsed, any trailing `/` kept. */
  glob: string;
  /** True when a leading `./` anchored the entry at the docs root instead of at any depth. */
  anchored: boolean;
}

function rendererEntry(entry: string): RendererEntry | null {
  if (entry.includes("\\")) return null;
  let rest = entry;
  let anchored = false;
  if (rest.startsWith("./")) {
    rest = rest.slice(2);
    anchored = true;
    // `.//x` — the dot survives as a literal directory name, so the pattern
    // names a path nothing on disk has.
    if (rest.startsWith("/")) return null;
  } else if (rest.startsWith("../")) {
    return null;
  }
  const trailing = rest.endsWith("/");
  const parts: string[] = [];
  for (const part of rest.split("/")) {
    if (part.length === 0 || part === ".") continue;
    if (part === "..") {
      if (parts.pop() === undefined) return null;
      continue;
    }
    parts.push(part);
  }
  // An entry that normalises to nothing at all is the project folder itself,
  // which `contains: true` makes a match for every document under it.
  const glob = parts.length === 0 ? "**" : `${parts.join("/")}${trailing ? "/" : ""}`;
  return { glob, anchored: anchored && parts.length > 0 };
}

/** The expression one entry matches with, or null when it matches nothing — `rendererEntry` says which. */
function matcherFor(parsed: RendererEntry, glob: string): RegExp {
  return new RegExp(`^${globSource(parsed.anchored ? glob : prefixed(glob))}`);
}

/**
 * An entry's segments with the trailing bare wildcards taken off — the question
 * "which directory is this line ABOUT", asked of the four spellings that name
 * one: `services/pay` doubled-star, that entry with a trailing `/*` after it,
 * `services/pay/*` and `services/pay/` all reduce to `services/pay`. A wildcard
 * that is NOT trailing survives — one segment of its own — because a starred
 * middle segment picks one directory level and no more.
 *
 * It is NOT the covering rule. What an entry HIDES is `entryRegex` below, and
 * the two answer differently on purpose: `services/pay/**` is about the
 * directory `services/pay`, while the bare `services/pay` hides
 * `services/payment-service` as well (measured — see below).
 *
 * It takes the NORMALISED glob, never the raw entry: an entry is split on `/`
 * alone, because a backslash is a literal to the renderer and splitting on it
 * here was what made `services\order-service\**` read as naming a directory it
 * hides nothing in.
 */
function patternSegments(glob: string): string[] {
  const parts = glob.split("/").filter((part) => part.length > 0);
  while (parts.length > 0 && (parts.at(-1) === "*" || parts.at(-1) === "**")) parts.pop();
  return parts;
}

/**
 * One `exclude` entry as the expression the RENDERER matches paths with:
 * anchored at the start of a path segment, and NOT anchored at the end.
 *
 * MEASURED, at the 1.59.2 pin, on a scratch fleet of five documents —
 * `architecture/landscape.likec4`, `architecture/usecases/uc.likec4`,
 * `services/payment-service/model.likec4`,
 * `services/payments/payment-service/model.likec4` and
 * `services/order-service/model.likec4` — counting the "N files" `npx likec4
 * validate .` reports with one entry in the list:
 *
 *   services/zzz                5    services/pay                3
 *   services/payment-service    4    a star as the middle segment  4
 *   services/pay/**             5    architect                   3
 *   architecture/*.likec4       4    *.likec4                    0
 *   ervices                     5    ces/payment-service         5
 *   payment-service             3    services/**                 2
 *   services                    2    services/payment-service/*  hides a nested file too
 *
 * Four rules come out of that table, and every one of them contradicts what
 * this module asserted before (verification 2026-09-04, review C): the match is
 * a raw PREFIX with no end anchor (`services/pay` takes both payment trees,
 * `architect` takes all of `architecture/`); it must START on a `/` boundary
 * (`ervices` and `ces/payment-service` take nothing); `*` stays inside one
 * segment (`architecture/*.likec4` leaves `architecture/usecases/uc.likec4`);
 * and a glob form does NOT prefix-match (`services/pay/**` needs the literal
 * separator, so it takes nothing from `services/payment-service`).
 *
 * The shape falls out of what LikeC4 does with the list: an entry that does not
 * already begin with a doubled star is prefixed with one, joined onto the
 * project folder and handed to picomatch with `contains: true` — and `contains`
 * is exactly the missing end anchor. So the optional any-directories group
 * `globSource` emits for a leading doubled star IS that prefix, and the absent
 * `$` is that option.
 *
 * NULL when the entry hides nothing at all — `rendererEntry` names the two
 * spellings that do, and every caller has to skip such an entry rather than
 * treat it as covering: a warning derived from one sent a team after a line the
 * renderer ignores, and `subsystem sync` then deleted it.
 */
function entryRegex(entry: string): RegExp | null {
  const parsed = rendererEntry(entry);
  return parsed === null ? null : matcherFor(parsed, parsed.glob);
}

/** An entry as LikeC4 spells it before matching: a doubled star in front, unless it has one. */
function prefixed(entry: string): string {
  return entry.startsWith("**") ? entry : `**/${entry}`;
}

/**
 * A glob as a regular-expression SOURCE. `**` crosses `/` and, followed by a
 * separator, may stand for no directory at all (a doubled star between two literals matches with no directory between them, which
 * is what makes a doubled-star-then-star entry cover a model directly under `services/`);
 * `*` and `?` never cross one.
 */
function globSource(pattern: string): string {
  let source = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      source += "(?:.*/)?";
      i += 3;
      continue;
    }
    if (pattern.startsWith("**", i)) {
      source += ".*";
      i += 2;
      continue;
    }
    const c = pattern[i]!;
    if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  return source;
}

/**
 * The entry that hides `relPath` from the root project, or null when nothing in
 * the list does. `relPath` is a docs-relative FILE path, spelled either way
 * round the slash.
 *
 * Returned VERBATIM because every message that carries it asks its reader to
 * delete or narrow THAT line, and an entry re-spelled by loam is a line they
 * would go looking for and not find.
 */
export function excludingPath(exclude: readonly string[], relPath: string): string | null {
  const path = segments(relPath).join("/");
  if (path.length === 0) return null;
  for (const entry of exclude) {
    if (entryRegex(entry)?.test(path) === true) return entry;
  }
  return null;
}

/**
 * The entry that hides a SERVICE TREE — the directory and everything under it —
 * or null. The tree's spelling is normalised here because the repository writes
 * it both ways: `serviceTreePath` includes the leading `services/` and the
 * entries `standaloneExclude` writes are built from the part under it, and
 * getting that wrong would silently answer "not excluded" for every service.
 *
 * A DIRECTORY IS NOT A FILE, and that is why this is not `excludingPath` on the
 * directory's own path. `services/payment-service/**` hides every document in
 * that tree while matching no prefix of the directory string itself — the
 * pattern wants the separator the directory path ends before. So a second arm
 * asks the other half: does the directory the entry NAMES (`patternSegments`,
 * the trailing wildcards off) contain this tree? Asking it of the named
 * directory rather than of the raw prefix is what keeps `services/pay/**` about
 * `services/pay` and away from `services/payment-service`, which is exactly
 * where the renderer leaves it.
 *
 * What this deliberately does NOT report is an entry that hides only PART of a
 * tree (`services/x/model`, say). The four findings that read this answer are
 * about a directory the renderer either loads or does not, and half of one is a
 * state `subsystem sync` has no entry to write for.
 */
export function excludingEntry(exclude: readonly string[], treePath: string): string | null {
  const tree = segments(treePath).join("/");
  if (tree.length === 0) return null;
  const full = tree === SERVICES || tree.startsWith(`${SERVICES}/`) ? tree : `${SERVICES}/${tree}`;
  for (const entry of exclude) {
    if (coversTree(entry, full)) return entry;
  }
  return null;
}

/** Does one entry hide `dir` and everything under it? The two arms `excludingEntry` documents. */
function coversTree(entry: string, dir: string): boolean {
  const parsed = rendererEntry(entry);
  // An entry that hides nothing covers nothing — the backslash spelling, which
  // loam used to read as covering the tree while the renderer loaded every file
  // in it (measured: 8 of 8), warning `service.model-excluded` about a healthy
  // service and then deleting the team's line on the next sync.
  if (parsed === null) return false;
  if (matcherFor(parsed, parsed.glob).test(dir)) return true;
  const named = patternSegments(parsed.glob);
  if (named.length === 0) return false;
  // The named directory, or an ancestor of it, matched on a segment boundary —
  // never mid-segment, which is the whole difference between this arm and the
  // prefix one above.
  return new RegExp(`${matcherFor(parsed, named.join("/")).source}(?:/|$)`).test(dir);
}

/**
 * The DIRECTORY an entry names, `/`-joined, or null when the entry does not
 * plainly name one — a wildcard segment between two literal ones, or the
 * leading doubled star of the `node_modules` glob.
 *
 * The trailing wildcards are what get stripped: `services/pay` doubled-star and
 * the three other spellings `patternSegments` lists all name `services/pay`. It
 * is the AUTHORSHIP question the writer asks — "did loam write this line, and is
 * it about a directory the enumeration returns?" — never the covering one, which
 * is `excludingEntry`'s.
 */
export function excludedDirectory(entry: string): string | null {
  const parsed = rendererEntry(entry);
  // An entry that hides nothing names nothing either, so a backslash spelling is
  // never loam's to rewrite: `subsystem sync` leaves it exactly where the team
  // put it, which is the only honest answer about a line the renderer ignores.
  if (parsed === null) return null;
  const parts = patternSegments(parsed.glob);
  return parts.some((part) => part.includes("*")) ? null : parts.join("/");
}
