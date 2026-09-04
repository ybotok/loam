/**
 * `ScannedElement.title` — the text layer's reading of a declaration's title,
 * pinned against the parser's.
 *
 * The archive's existence check joins by id and, for a delta spelling an
 * element under its own identifier, by TITLE. Once the merge started writing
 * into extending models, that second join had to read them too
 * (`src/core/c4/splice/identity/declared.ts`), and the only title a text scan
 * can see is the one the declaration's head names. So this file pins both
 * halves of that claim: where the scan reports a title it is the parser's, and
 * where it reports none it is because the head named none — never because the
 * scan misread one.
 */
import { describe, expect, it } from "vitest";
import { loadSource } from "../src/core/c4/likec4.js";
import { scanModel } from "../src/core/c4/source-scan.js";

/** Both declaration forms, titled and untitled, nested and top-level. */
const SRC = `specification {
  element system
  element container
}

model {
  payments = system 'Payments API' {
    api = container 'api'
    container worker 'Background worker'
    container plain
    bare = container
  }
  quoted = system 'It\\'s "here"'
}
`;

describe("the scan reads a declaration's title from its head, the way the parser does", () => {
  it("every scanned title is the parsed title of the same element", async () => {
    const doc = await loadSource(SRC);
    expect(doc.errors).toEqual([]);
    const parsed = new Map(doc.elements.map((e) => [e.id, e.title]));
    const scan = scanModel(SRC)!;
    const titled = scan.elements.filter((e) => e.title !== undefined);
    // Not vacuous: the fixture titles four of its six declarations.
    expect(titled.length).toBe(4);
    for (const e of titled) expect([e.id, e.title]).toEqual([e.id, parsed.get(e.id)]);
  });

  it("both declaration forms are read, and an escaped quote inside a title survives", () => {
    const byId = new Map(scanModel(SRC)!.elements.map((e) => [e.id, e.title]));
    expect(byId.get("payments")).toBe("Payments API");
    expect(byId.get("payments.api")).toBe("api");
    expect(byId.get("payments.worker")).toBe("Background worker");
    expect(byId.get("quoted")).toBe(`It's "here"`);
  });

  it("a declaration whose head names no title carries none — the parser's default is not a title to join on", async () => {
    const byId = new Map(scanModel(SRC)!.elements.map((e) => [e.id, e.title]));
    expect(byId.get("payments.plain")).toBeUndefined();
    expect(byId.get("payments.bare")).toBeUndefined();
    // The parser does give those a title — the element's own name — which is
    // exactly why the scan must not report one: two documents that name an
    // element differently give it different default titles, so a default can
    // only ever match when the ids already do.
    const doc = await loadSource(SRC);
    expect(doc.elements.find((e) => e.id === "payments.plain")?.title).toBe("plain");
  });

  it("KNOWN: a title written as a body property is not read here", async () => {
    const src = `specification {
  element system
}

model {
  a = system {
    title 'Named in the body'
  }
}
`;
    const doc = await loadSource(src);
    expect(doc.errors).toEqual([]);
    expect(doc.elements[0]!.title).toBe("Named in the body");
    // The scan reports nothing rather than the wrong thing, and the archive's
    // title join simply skips the element: a missing match adds a box the
    // author can see, a wrong one drops one silently.
    expect(scanModel(src)!.elements[0]!.title).toBeUndefined();
  });
});
