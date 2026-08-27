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
