/**
 * Every registered command carries a `--help` heading.
 *
 * Twenty-eight commands printed as one flat, registration-ordered list tells a
 * new reader nothing about which four to run first, and a pilot operator's
 * first `loam --help` is a data point the scorecard records. The grouping is
 * typography rather than contract — but the FAIL-CLOSED rule is what keeps it
 * from rotting: a twenty-ninth command added without a heading must fail here,
 * not land silently in an unclassified bucket at the bottom of the page.
 *
 * The second assertion is the one that matters more. Nothing may be hidden: a
 * hidden command is a command an agent cannot discover, and this whole product
 * is built on agents reading `--help` and the JSON contract rather than
 * guessing.
 */
import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

/** The headings, in the order the work happens. A new one is a deliberate act. */
const EXPECTED_GROUPS = [
  "Set up",
  "Read the fleet",
  "Adopt what exists",
  "Change it",
  "Check it",
  "Ship it",
  "Migrate",
];

describe("the --help groups", () => {
  it("gives every registered command a heading", () => {
    const ungrouped = buildProgram()
      .commands.filter((c) => c.helpGroup() === "")
      .map((c) => c.name());
    expect(ungrouped, `command(s) with no HELP_GROUPS heading in src/cli.ts: ${ungrouped.join(", ")}`).toEqual([]);
  });

  it("uses only the declared headings", () => {
    const used = [...new Set(buildProgram().commands.map((c) => c.helpGroup()))];
    const stray = used.filter((g) => !EXPECTED_GROUPS.includes(g));
    expect(stray, `heading(s) not in EXPECTED_GROUPS: ${stray.join(", ")}`).toEqual([]);
    // Every declared heading is used: a group nobody is in is a group to delete.
    const unused = EXPECTED_GROUPS.filter((g) => !used.includes(g));
    expect(unused, `declared heading(s) no command uses: ${unused.join(", ")}`).toEqual([]);
  });

  it("hides nothing", () => {
    const hidden = buildProgram()
      .commands.filter((c) => (c as { _hidden?: boolean })._hidden === true)
      .map((c) => c.name());
    expect(hidden, "a hidden command is one an agent cannot discover").toEqual([]);
  });
});
