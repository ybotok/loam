/**
 * The use-case byte gate (`referencesReservedTag` in src/core/usecases/fleet.ts)
 * on its own: what it answers, and what that answer costs.
 *
 * The end-to-end cases — a `#suite-` written with comments after its `#` is
 * still graded, prose naming a prefix is not loaded — live with the readers
 * that run the gate (test/usecase-service-flow.test.ts and the blast-radius,
 * context-pack and list-suites files). This file holds the two properties no
 * fixture can: that the one-pass table answers exactly what the walk it
 * replaced answered, over inputs no hand-written fixture would think of, and
 * that a crafted document cannot make the gate quadratic.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mentionsTagPrefix, referencesReservedTag } from "../src/core/usecases/fleet.js";

const PREFIXES = ["cap-", "req-", "suite-", "obl-"];

/**
 * The walk the first version made from each `#`, kept here verbatim as the
 * specification of WHAT the gate answers: forward from the `#` past
 * whitespace, line breaks, `//` comments and block comments — an unclosed
 * opener stepped over alone — then ask whether a reserved prefix starts there.
 * It is the right answer and the wrong cost: every `#` inside a run re-walks
 * the run.
 */
function walkedAnswer(text: string): boolean {
  for (let hash = text.indexOf("#"); hash !== -1; hash = text.indexOf("#", hash + 1)) {
    let next = hash + 1;
    for (;;) {
      const char = text[next];
      if (char === " " || char === "\t" || char === "\r" || char === "\n") {
        next += 1;
      } else if (text.startsWith("//", next)) {
        next += 2;
        while (next < text.length && text[next] !== "\n" && text[next] !== "\r") next += 1;
      } else if (text.startsWith("/*", next)) {
        const close = text.indexOf("*/", next + 2);
        next = close === -1 ? next + 2 : close + 2;
      } else {
        break;
      }
    }
    if (PREFIXES.some((prefix) => text.startsWith(prefix, next))) return true;
  }
  return false;
}

/** mulberry32: a seeded generator, so a failing input is the same input on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("what the gate answers", () => {
  it("opens on a reserved prefix after a `#` and LikeC4's hidden tokens, and on nothing else", () => {
    const opens = [
      "#suite-smoke",
      "#obl-outbox",
      "tags # cap-checkout",
      "#\n\treq-PAY-AUTH",
      "#\r\nsuite-smoke",
      "#/* the stand */suite-smoke",
      "#/**/suite-smoke",
      "# // and its double\n    suite-smoke",
      "#/* a */ /* b */\n// c\r suite-smoke",
      // An unclosed opener is stepped over alone: the name after it counts.
      "#/* suite-smoke",
      // A `#` inside a comment is still tried — the scan over-approximates.
      "#/* #suite-smoke */ title",
    ];
    const shut = [
      "",
      "suite-smoke",
      "tag cap-checkout",
      "#title 'the e2e-suite-a job'",
      // The name is inside the line comment, never after it.
      "#// suite-smoke",
      // The opener's `*` is not its closer's: `/*/` is still open, and the
      // walk stops at the `/` after it.
      "#/*/suite-smoke",
      "#x suite-smoke",
      "# 'suite-smoke'",
    ];
    for (const text of opens) expect(referencesReservedTag(text), JSON.stringify(text)).toBe(true);
    for (const text of shut) expect(referencesReservedTag(text), JSON.stringify(text)).toBe(false);
  });

  it("answers exactly what the walk from each `#` answered, over every shape the tokens can interleave in", () => {
    // Short strings over the alphabet the walk branches on — the hidden
    // tokens, both comment openers and the closer, a `#`, a prefix and a word
    // — so every boundary the table has to get right (an opener at the very
    // end, a closer overlapping its opener, a line comment ending in `\r`)
    // turns up many times over.
    const pieces = ["#", "/", "*", " ", "\t", "\n", "\r", "//", "/*", "*/", "x", "suite-", "cap-", "req-", "obl-"];
    const next = seeded(0x10a3);
    let opened = 0;
    for (let n = 0; n < 20_000; n += 1) {
      const length = Math.floor(next() * 16);
      let text = "";
      for (let i = 0; i < length; i += 1) text += pieces[Math.floor(next() * pieces.length)];
      const expected = walkedAnswer(text);
      if (expected) opened += 1;
      expect(referencesReservedTag(text), JSON.stringify(text)).toBe(expected);
    }
    // Both answers turn up often enough to mean something.
    expect(opened).toBeGreaterThan(1_000);
    expect(opened).toBeLessThan(19_000);
  });
});

describe("which documents the gate reads tags in", () => {
  // `obl-` is the one prefix normally written on the MAP — on elements and
  // edges — rather than on a view. A document that declares no `dynamic view`
  // declares no use case whatever it tags, so a fleet tagging its edges
  // `#obl-` must not load the project for use cases it cannot have.
  async function opens(text: string): Promise<boolean> {
    const dir = await mkdtemp(join(tmpdir(), "loam-gate-"));
    try {
      const path = join(dir, "landscape.likec4");
      await writeFile(path, text);
      return await mentionsTagPrefix([path]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("stays shut on a map that tags an edge `#obl-` and declares no dynamic view", async () => {
    expect(await opens("model {\n  a -> b 'calls' {\n    #obl-outbox\n  }\n}\n")).toBe(false);
  });

  it("opens on a dynamic view tagged `#obl-`", async () => {
    expect(await opens("views {\n  dynamic view uc_relay {\n    #obl-outbox\n    a -> b\n  }\n}\n")).toBe(true);
  });
});

describe("what the gate costs", () => {
  it("reads a crafted document in one pass — a run of `#`s inside comments costs no more than its length", () => {
    // Each shape below made the walk re-read the rest of a run once per `#`
    // inside it: an unclosed `/*` searched the rest of the file for a closer
    // (`#/*` repeated took 17.6 s on 100 KB), a closer at the very end was
    // found again from every opener, a `//` ran to the same line break from
    // every `#` on the line, and a long tail of comment lines was walked from
    // every `#` before it. At 256 KB that walk takes from tens of seconds to
    // minutes per shape; the table takes milliseconds. The bound is wall time
    // because the repeated work lived inside the native `indexOf` and
    // `startsWith`, which no counter in loam's code can see — and it is set
    // two orders of magnitude above what one pass takes, so a busy machine
    // cannot trip it while a quadratic scan cannot get under it.
    const size = 256 * 1024;
    const shapes: Record<string, string> = {
      "`#//` on one line": "#//".repeat(size / 3),
      "`#/*` never closed": "#/*".repeat(size / 3),
      "`#/*` closed once at the end": "#/*".repeat(size / 3) + "*/",
      "`#//` then a tail of comment lines": "#//".repeat(size / 6) + "\n" + "//\n".repeat(size / 6),
      "every `#` stopped by a name after a comment": "#/* x */y".repeat(size / 9),
    };
    for (const [shape, body] of Object.entries(shapes)) {
      // A prefix written where no `#` reaches it, so the answer is still no
      // but the text cannot be answered before the table is built — a gate
      // that skipped these on a missing prefix would time nothing.
      const text = `suite-\n${body}`;
      const started = performance.now();
      const answer = referencesReservedTag(text);
      const elapsed = performance.now() - started;
      expect(answer, shape).toBe(false);
      expect(elapsed, `${shape}: ${Math.round(elapsed)}ms over ${text.length} bytes`).toBeLessThan(2_000);
    }
  });
});
