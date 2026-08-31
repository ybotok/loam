/**
 * Regenerate `meta/docs/AGENTS.md` from the sections that produce it.
 *
 * `AGENTS.md` in a docs repo is GENERATED — `loam init --create` writes it out
 * of `src/core/agent/agents-md.ts` — and loam deliberately never rewrites it
 * afterwards. `agents.stale` is detection only, and it detects on the version
 * STAMP: a docs repo whose file was written by this version and has since been
 * left behind by a same-version change to those sections is silently wrong, and
 * every command reports the repo healthy. That is somebody else's problem in a
 * fleet, where the file travels with the docs and a version bump surfaces it.
 * It is OURS in `meta/`, where the sections and the file live in one repository
 * and one commit can move the first without the second.
 *
 * It had already happened when this script was written: `meta/docs/AGENTS.md`
 * trailed `src/` by the AsyncAPI and OpenAPI merge sections, and nothing said
 * so. Hence a script rather than a paragraph telling somebody to write one.
 *
 * `--check` compares and refuses instead of writing, which is what CI wants;
 * bare, it writes. Either way the STAMP LINE is compared first and a difference
 * there refuses outright: a stamp change means the version moved, which is a
 * release-checklist question about what else must move with it, not a drift
 * this script should paper over.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENTS_MD } from "../src/core/agent/agents-md.js";

const TARGET = join(import.meta.dirname, "..", "meta", "docs", "AGENTS.md");
const check = process.argv.includes("--check");

/** The file's own line endings, so a rewrite is a content diff and not a whitespace one. */
function withEndings(text: string, crlf: boolean): string {
  const lf = text.replace(/\r\n/g, "\n");
  return crlf ? lf.replace(/\n/g, "\r\n") : lf;
}

const current = await readFile(TARGET, "utf8");
const fresh = withEndings(AGENTS_MD, current.includes("\r\n"));

const stampOf = (text: string): string => text.split(/\r?\n/)[0] ?? "";
if (stampOf(current) !== stampOf(fresh)) {
  console.error(
    `meta-agents: the generated-by stamp differs — ${stampOf(current)} on disk, ${stampOf(fresh)} from src/.\n` +
      "That is a version bump, not drift. Re-stamping is a release step: decide what else moves with it first.",
  );
  process.exitCode = 1;
} else if (current === fresh) {
  console.log("meta-agents: meta/docs/AGENTS.md matches the sections that generate it");
} else if (check) {
  console.error(
    "meta-agents: meta/docs/AGENTS.md is BEHIND src/core/agent/ — same stamp, different content, so `agents.stale`\n" +
      "cannot see it and every command reports the repo healthy. Run `npm run meta:agents` and commit the result.",
  );
  process.exitCode = 1;
} else {
  await writeFile(TARGET, fresh);
  console.log("meta-agents: rewrote meta/docs/AGENTS.md from src/core/agent/");
}
