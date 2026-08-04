/**
 * Frontmatter fence detection (src/core/frontmatter.ts `bounds`).
 *
 * The fences used to be substrings: any first line starting `---` opened a
 * block, and the first `\n---` anywhere closed one. So `--- title` was read as
 * an opener, a `----` horizontal rule closed the header early, and a
 * `--- note` closer silently ate its own trailing text — three ways for a
 * document to lose bytes or grow a header its author never wrote. Jekyll's
 * actual rule is line-anchored: the opener is line 1 matching `/^---\s*$/`,
 * the closer the first subsequent line matching the same. These tests pin that
 * rule from both sides of the one function the reader and the writer share —
 * `withFrontmatterFields` promises the body back byte-for-byte, and that
 * promise is only as good as the fence decision.
 *
 * BOM stripping and the field accessors are covered in provenance.test.ts;
 * the command-level BOM story lives in bom.test.ts.
 */
import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringField, withFrontmatterFields } from "../src/core/frontmatter.js";

/** Written escaped: a literal U+FEFF in this source would itself be invisible. */
const BOM = "﻿";

describe("fences are lines, not substrings", () => {
  it("`--- title` on line 1 is prose, not an opener", () => {
    const md = "--- title\n\nSome text.\n";
    const fm = parseFrontmatter(md);
    expect(fm.present).toBe(false);
    expect(fm.body).toBe(md);
  });

  it("the writer agrees: `--- title` gets a fresh header, and stays in the body", () => {
    const md = "--- title\n\nSome text.\n";
    expect(withFrontmatterFields(md, { status: "draft" })).toBe(
      `---\nstatus: draft\n---\n\n${md}`,
    );
  });

  it("a `----` horizontal rule does not close the block", () => {
    // The rule line is inside the header now, where it is malformed YAML — so
    // the data collapses to {} (the documented fallback) rather than the header
    // ending early and `----` leaking a phantom `---\n` line into the body.
    const fm = parseFrontmatter("---\ntitle: x\n----\n---\nbody\n");
    expect(fm.present).toBe(true);
    expect(fm.body).toBe("body\n");
  });

  it("a key starting with dashes is header, not a closer", () => {
    // Same fence logic as the rule above, but valid YAML: the old substring
    // match cut the header at `\n---dashed`, so the second field just vanished.
    const fm = parseFrontmatter("---\ntitle: x\n---dashed: y\n---\nbody\n");
    expect(stringField(fm, "title")).toBe("x");
    expect(stringField(fm, "---dashed")).toBe("y");
    expect(fm.body).toBe("body\n");
  });

  it("a `---` inside a block scalar stays in the header", () => {
    const fm = parseFrontmatter("---\nnote: |\n  ---\n  not a fence\nstatus: draft\n---\nbody\n");
    expect(stringField(fm, "status")).toBe("draft");
    expect(stringField(fm, "note")).toBe("---\nnot a fence\n");
    expect(fm.body).toBe("body\n");
  });

  it("a closer with trailing text does not close — the block is unterminated, the text whole", () => {
    // The old closer was the worst of the three: `--- note` matched `\n---`,
    // and ` note` fell between end and bodyStart — bytes gone without a word.
    const md = "---\na: 1\n--- note\nbody\n";
    const fm = parseFrontmatter(md);
    expect(fm.present).toBe(false);
    expect(fm.body).toBe(md);
  });

  it("trailing whitespace on a fence is tolerated, CRLF included", () => {
    const fm = parseFrontmatter("---  \r\nstatus: draft\r\n---\r\nbody\r\n");
    expect(fm.present).toBe(true);
    expect(stringField(fm, "status")).toBe("draft");
    expect(fm.body).toBe("body\r\n");
  });
});

describe("the writer round-trips", () => {
  /** Frontmatter plus every body shape the fence rule could mistake for one. */
  const DOC = "---\nservice: x\nstatus: draft\n---\n\nIntro\n\n---\n\n----\n\n--- aside\n\nEnd\n";

  it("a no-op edit returns the document byte-for-byte", () => {
    expect(withFrontmatterFields(DOC, {})).toBe(DOC);
  });

  it("stamping a field touches only that line — rules and dashes in the body survive", () => {
    const out = withFrontmatterFields(DOC, { status: "verified" });
    expect(out).toBe(DOC.replace("status: draft", "status: verified"));
    // And re-reading the stamped document sees the same body the original had.
    expect(parseFrontmatter(out).body).toBe(parseFrontmatter(DOC).body);
  });

  it("the documented BOM behavior is intact: read through, dropped on write", () => {
    expect(parseFrontmatter(BOM + DOC).present).toBe(true);
    expect(withFrontmatterFields(BOM + DOC, {})).toBe(DOC);
  });
});

describe("the malformed flag — unreadable is not the same fact as empty", () => {
  it("broken YAML in the header sets malformed, keeps data {} and the body intact", () => {
    const fm = parseFrontmatter("---\nstatus: [unclosed\n---\n\n# Title\n");
    expect(fm.present).toBe(true);
    expect(fm.malformed).toBe(true);
    expect(fm.data).toEqual({});
    expect(fm.body).toContain("# Title");
  });

  it("a scalar header is malformed too — there are no fields to read in it", () => {
    const fm = parseFrontmatter("---\njust some prose\n---\n\nBody\n");
    expect(fm.present).toBe(true);
    expect(fm.malformed).toBe(true);
  });

  it("a sequence header is malformed — a list holds no owner/status either", () => {
    const fm = parseFrontmatter("---\n- a\n- b\n---\n\nBody\n");
    expect(fm.malformed).toBe(true);
    expect(fm.data).toEqual({});
  });

  it("an EMPTY block is legal and NOT malformed — absence of fields, not unreadability", () => {
    const fm = parseFrontmatter("---\n---\n\n# Title\n");
    expect(fm.present).toBe(true);
    expect(fm.malformed).toBe(false);
  });

  it("a valid header is not malformed, and a missing one is neither present nor malformed", () => {
    const ok = parseFrontmatter("---\nstatus: draft\n---\n\nBody\n");
    expect(ok.malformed).toBe(false);
    expect(stringField(ok, "status")).toBe("draft");
    const none = parseFrontmatter("# Just a doc\n");
    expect(none.present).toBe(false);
    expect(none.malformed).toBe(false);
  });
});
