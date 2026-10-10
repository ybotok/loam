/**
 * The four commands of the single-repo trial's first hour, each with the
 * reason it is there. `init` prints them as its epilogue when one run both
 * creates the docs repo and leaves a service bound (init.ts holds that guard
 * and the why).
 *
 * A module of its own for two reasons. The seam: init.ts is the wiring — the
 * flag guards and the scaffold sequence — while this table is what the trial
 * user is told, and the table alone pushed init.ts past the 300-line limit.
 * The export: test/agent-commands-runnable.test.ts feeds these commands
 * through the real commander program by IMPORT, because the printed lines are
 * plain text inside template literals — no markdown backticks, no
 * single-quoted `loam` forms — so that suite's literal scrape cannot see
 * them, and they are the first instruction a single-repo trial user receives:
 * the exact class its header records shipping broken once as `loam adopt
 * <id>`. README.md's Quick start reprints the same four lines, and
 * test/cli.test.ts pins that copy to this table.
 */
export function firstHour(service: string): Array<[command: string, why: string]> {
  return [
    [`loam adopt --service ${service} --json`,
      "the brief: an agent reads the code, writes the baseline as draft"],
    [`loam validate --service ${service}`, "grade the result in this repo"],
    [`loam vouch --service ${service}`, "you, not the agent: draft -> verified"],
    ["loam status", "what to do next, derived from the files"],
  ];
}

/**
 * The first hour of a docs repo created with NO service bound — WORKFLOW.md's
 * Day zero steps 2–4, and the same rungs `loam status` answers on an empty
 * fleet (`next.author-landscape`, `next.bind-service`, `next.adopt-first`).
 *
 * This run used to print nothing after the scaffold list: the single-repo
 * table above needs a service id to name, and the guard that withheld it read
 * "nothing is bound" as "nothing to say". But this is the Day zero composition
 * itself — the person who just created the fleet's shared repo — and its next
 * steps are as fixed as the trial's: state the map, bind each service's own
 * repo, adopt. The ids are placeholders because nothing here knows them yet,
 * which is also why the runnable-commands suite substitutes them like every
 * other `<id>` it parses. Exported for that suite, by import, for the reason
 * the header gives.
 */
export function docsRepoFirstHour(): Array<[command: string, why: string]> {
  return [
    ["loam seed --from fleet.yaml", "the fleet map from a fleet.yaml you write, or draw it by hand"],
    ["loam init --docs <docs-repo> --service <id>", "in each service's own repo: bind it, commit loam.json"],
    ["loam adopt --service <id> --json", "there: the brief, an agent writes the baseline as draft"],
    ["loam status", "what to do next, derived from the files"],
  ];
}

/**
 * The epilogue's printed lines — the heading and one aligned `command   # why`
 * row per step — for whichever first hour this run earned. Rendering only:
 * init.ts decides WHETHER (never on a join), this decides which table and how
 * it reads, so the two variants cannot drift into two layouts.
 */
export function firstHourLines(service: string | undefined): string[] {
  const [heading, steps] = service === undefined
    ? ["next — the docs repo's first hour:", docsRepoFirstHour()]
    : ["next — the first hour:", firstHour(service)];
  const width = Math.max(...steps.map(([command]) => command.length));
  return [`  ${heading}`, ...steps.map(([command, why]) => `    ${command.padEnd(width)}   # ${why}`)];
}
