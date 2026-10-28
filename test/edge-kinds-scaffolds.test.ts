/**
 * The scaffolds draw edges the way the protocol tells an agent to.
 *
 * `loam instructions loam-feature` says to draw every edge with its relationship
 * kind (`-[calls]->`), and the scaffolded map declares the seven kinds — yet the
 * QUICKSTART walk (2026-10-28) found the files a new user copies from first
 * teaching the other spelling: the `delta.likec4` example edge and QUICKSTART's
 * own map edit drew a bare `->`. And the map `loam init` scaffolds told its
 * reader to tag a broker `#external` without declaring the tag, while the map
 * `loam seed` writes did — so the first external element drawn by hand, as the
 * comments said to, was an undeclared tag and a map that no longer parsed.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSource } from "../src/core/c4/likec4.js";
import { deltaTemplate } from "../src/commands/new/templates.js";
import { isLandscapeStub, LANDSCAPE_STUB } from "../src/core/scaffold/landscape.js";
import { LEGACY_LANDSCAPE_STUBS } from "../src/core/scaffold/legacy.js";
import { makeTmpDir, runLoam } from "./helpers/harness.js";

interface Finding {
  code: string;
  severity: string;
  message: string;
}

describe("the map `loam init` scaffolds declares #external", () => {
  it("an external element drawn by hand, as the stub's comments say, parses and asks for no services/ directory", async () => {
    const dir = await makeTmpDir("loam-init-external-");
    try {
      expect((await runLoam(dir, "init", "--docs", "./d", "--create")).code).toBe(0);
      const map = join(dir, "d", "architecture", "landscape.likec4");
      const stub = (await readFile(map, "utf8")).replace(/\r\n/g, "\n");
      expect(stub).toContain("\n  tag external\n");
      // The hand edit QUICKSTART's readers make: one service, one partner
      // system tagged external, one call between them drawn with its kind.
      const drawn = stub.replace(
        "model {\n}",
        "model {\n" +
          "  svc_order_service = softwareSystem 'order-service' {\n    metadata { service 'order-service' }\n  }\n" +
          "  stripe = softwareSystem 'Stripe' {\n    #external\n  }\n" +
          "  svc_order_service -[calls]-> stripe 'Charges the card'\n" +
          "}",
      );
      expect(drawn).not.toBe(stub);
      await writeFile(map, drawn);
      const run = await runLoam(dir, "validate", "--all", "--json");
      const findings = (JSON.parse(run.stdout) as { targets: Array<{ findings: Finding[] }> }).targets.flatMap((t) => t.findings);
      expect(findings.filter((f) => f.code === "landscape.invalid")).toEqual([]);
      expect(findings.some((f) => f.message.includes("Stripe") && f.code.startsWith("landscape.binding"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("the stub that shipped without it is still recognised as untouched, so seed still replaces it", () => {
    const previous = LEGACY_LANDSCAPE_STUBS[LEGACY_LANDSCAPE_STUBS.length - 1]!;
    expect(previous).not.toContain("tag external");
    expect(previous).toContain("color redisRed");
    expect(isLandscapeStub(previous)).toBe(true);
    expect(isLandscapeStub(LANDSCAPE_STUB)).toBe(true);
  });
});

describe("the delta.likec4 scaffold draws its example edge with a kind", () => {
  it("the example, uncommented, is a `-[calls]->` edge and the file parses alone", async () => {
    const text = deltaTemplate("FEAT-1", ["order-service"], ["payment-service"]);
    expect(text).toContain("// svc_order_service -[calls]-> svc_payment_service 'Calls createSplit' {");
    expect(text).not.toMatch(/\/\/ \S+ -> \S+ 'Calls/);
    // Uncomment exactly what the comment tells the author to: the context
    // element the edge names, and the edge itself.
    const live = text
      .replace("  // svc_order_service = softwareSystem 'order-service'", "  svc_order_service = softwareSystem 'order-service'")
      .replace(
        "  // svc_order_service -[calls]-> svc_payment_service 'Calls createSplit' {\n  //   #FEAT-1\n  //   metadata { op 'createSplit' }\n  // }",
        "  svc_order_service -[calls]-> svc_payment_service 'Calls createSplit' {\n    #FEAT-1\n    metadata { op 'createSplit' }\n  }",
      );
    expect(live).toContain("\n  svc_order_service -[calls]-> svc_payment_service");
    const doc = await loadSource(live);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships).toHaveLength(1);
  });
});

describe("QUICKSTART draws edges the way the protocol does", () => {
  it("every edge in a likec4 block carries a relationship kind", async () => {
    const quickstart = (await readFile(new URL("../QUICKSTART.md", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const blocks = [...quickstart.matchAll(/```likec4\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThan(0);
    const bare = blocks.flatMap((block) => block.split("\n")).filter((line) => /^\s*[\w.]+\s+->\s+[\w.]+/.test(line));
    expect(bare).toEqual([]);
  });
});
