/**
 * The root `likec4.config.json`'s `exclude` list — the ONE literal fact loam
 * reads out of a file it otherwise only writes, and the list `loam subsystem
 * sync` writes back.
 *
 * Every case here is a repair loop that would otherwise be silent. A model that
 * extends the fleet map lives in the ROOT project, so an `exclude` entry
 * covering its directory means the renderer never loads it — the service is a
 * box with nothing inside it and no check can say why. A model that stands
 * alone is the opposite: unexcluded, every kind it declares is a duplicate
 * blamed on the map as well, and the whole root project blanks.
 *
 * The two rules with teeth are the START boundary (`services/pay/**` is not
 * about `services/payment`, and neither is `ces/payment-service`) and WHOSE
 * ENTRY IS WHOSE (a sync must recompute the entries loam wrote and never touch
 * the ones a team wrote).
 *
 * Every covering claim below is MEASURED, at the 1.59.2 pin, by putting the
 * entry in a scratch fleet's root `likec4.config.json` and counting the "N
 * files" `npx likec4 validate .` reports. The fleet holds five documents:
 * `architecture/landscape.likec4`, `architecture/usecases/uc.likec4`,
 * `services/payment-service/model.likec4`,
 * `services/payments/payment-service/model.likec4` and
 * `services/order-service/model.likec4`. `exclude.ts`'s own banner carries the
 * whole table; the numbers quoted per case are rows of it.
 */
import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { docsDirOf } from "../src/core/kernel/ids/dirs.js";
import { excludingEntry, excludingPath, readRootExclude } from "../src/core/c4/root-project/exclude.js";
import { standaloneExclude } from "../src/core/c4/service-model/renderer.js";
import { makeTmpDir, writeFiles } from "./helpers/harness.js";

/** A docs root holding exactly the given files, for one read. */
async function docsWith(files: Record<string, string>): Promise<{ dir: ReturnType<typeof docsDirOf>; cleanup: () => Promise<void> }> {
  const root = await makeTmpDir("loam-root-exclude-");
  await writeFiles(root, files);
  return { dir: docsDirOf(root), cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("readRootExclude answers three different things, and they are not interchangeable", () => {
  it("reads the entries a real project file lists, in file order", async () => {
    const fx = await docsWith({
      "likec4.config.json": JSON.stringify({ name: "fleet", exclude: ["features/**", "services/payment/**"] }),
    });
    try {
      expect(await readRootExclude(fx.dir)).toEqual(["features/**", "services/payment/**"]);
    } finally {
      await fx.cleanup();
    }
  });

  it("reads a missing `exclude` key as the empty list — the renderer excludes nothing", async () => {
    const fx = await docsWith({ "likec4.config.json": JSON.stringify({ name: "fleet" }) });
    try {
      expect(await readRootExclude(fx.dir)).toEqual([]);
    } finally {
      await fx.cleanup();
    }
  });

  it("answers null — not [] — for a file that is absent, unparseable, or not an object", async () => {
    // Null and [] must stay distinct: [] asserts the renderer excludes nothing,
    // and asserting that about a file loam could not read is how a grader ends
    // up claiming a model is visible when nobody knows.
    const absent = await docsWith({ "architecture/landscape.likec4": "" });
    const broken = await docsWith({ "likec4.config.json": "{ not json" });
    const array = await docsWith({ "likec4.config.json": "[]" });
    const wrongType = await docsWith({ "likec4.config.json": JSON.stringify({ exclude: "services/**" }) });
    const wrongEntry = await docsWith({ "likec4.config.json": JSON.stringify({ exclude: ["features/**", 7] }) });
    try {
      expect(await readRootExclude(absent.dir)).toBeNull();
      expect(await readRootExclude(broken.dir)).toBeNull();
      expect(await readRootExclude(array.dir)).toBeNull();
      expect(await readRootExclude(wrongType.dir)).toBeNull();
      expect(await readRootExclude(wrongEntry.dir)).toBeNull();
    } finally {
      await Promise.all([absent, broken, array, wrongType, wrongEntry].map((fx) => fx.cleanup()));
    }
  });
});

describe("excludingEntry reads an entry the way the renderer does", () => {
  it("names the literal `services/**` for any service", () => {
    expect(excludingEntry(["features/**", "services/**"], "payment-service")).toBe("services/**");
    expect(excludingEntry(["services/**"], "platform/identity-service")).toBe("services/**");
  });

  it("names a subsystem entry for a service filed under it", () => {
    expect(excludingEntry(["services/platform/**"], "platform/identity-service")).toBe("services/platform/**");
  });

  // Catches: the `/**`-suffix-only rule coming back. Each of these hides the
  // model from the renderer — measured on a scratch fleet at the 1.59.2 pin,
  // `npx likec4 validate .` drops from 2 source files to 1 for every one of them
  // — and reading only the first spelling meant a root config written any of the
  // other four ways hid every extending model with zero findings
  // (verification 2026-09-04, E2).
  it("names every spelling the renderer treats as `services/`, not just the `/**` one", () => {
    for (const entry of ["services/**", "services/**/*", "services/*", "services/", "services"]) {
      expect(excludingEntry([entry], "payment-service"), entry).toBe(entry);
      expect(excludingEntry([entry], "platform/identity-service"), entry).toBe(entry);
    }
  });

  it("names every spelling of the SERVICE's own directory", () => {
    const tree = "payment-service";
    for (const entry of [
      "services/payment-service/**",
      "services/payment-service/**/*",
      "services/payment-service/*",
      "services/payment-service/",
      "services/payment-service",
    ]) {
      expect(excludingEntry([entry], tree), entry).toBe(entry);
    }
  });

  it("does NOT match a sibling through a GLOB whose literal part is a prefix of it", () => {
    // Measured: `services/pay/**` leaves all five files loaded — the glob wants
    // the literal separator, so it is about the directory `pay` and nothing
    // else. Reporting `payment` excluded would send its author to delete an
    // entry that was never about them, while the real reason their model does
    // not render goes unfound.
    expect(excludingEntry(["services/pay/**"], "payment")).toBeNull();
    expect(excludingEntry(["services/platform/**"], "platformish-service")).toBeNull();
  });

  // Catches: the segment-walking matcher this module carried until review C.
  // It asserted "`services/pay` takes nothing from `services/payment-service`",
  // and the renderer does the opposite — measured, that entry drops the file
  // count from 5 to 3, hiding BOTH payment trees. A bare entry is a raw prefix.
  it("matches a sibling through a BARE entry that is a prefix of it — measured, not assumed", () => {
    expect(excludingEntry(["services/pay"], "payment")).toBe("services/pay");
    expect(excludingEntry(["services/pay"], "payments/payment-service")).toBe("services/pay");
    expect(excludingEntry(["services/platform"], "platformish-service")).toBe("services/platform");
  });

  // The other half of the same rule: a prefix only counts from a `/` boundary.
  // Measured, `ervices` and `ces/payment-service` each leave all five loaded.
  it("never starts a match in the MIDDLE of a segment", () => {
    expect(excludingEntry(["ervices"], "payment-service")).toBeNull();
    expect(excludingEntry(["ces/payment-service"], "payment-service")).toBeNull();
  });

  // Measured: the bare `payment-service` drops the count from 5 to 3, taking
  // the tree at the root AND the one filed under `services/payments/`, because
  // LikeC4 prefixes an entry with a recursive segment before matching it.
  it("matches a tree at any depth, because the entry is matched with a recursive prefix", () => {
    expect(excludingEntry(["payment-service"], "payment-service")).toBe("payment-service");
    expect(excludingEntry(["payment-service"], "payments/payment-service")).toBe("payment-service");
  });

  it("reads a wildcard in the MIDDLE of an entry as one segment", () => {
    // Measured: `services/<star>/svc-b` hides the filed service and leaves its
    // unfiled siblings alone.
    expect(excludingEntry(["services/*/identity-service"], "platform/identity-service")).toBe(
      "services/*/identity-service",
    );
    expect(excludingEntry(["services/*/identity-service"], "payment-service")).toBeNull();
  });

  it("interprets nothing about another root's tree", () => {
    expect(excludingEntry(["features/**", "**/node_modules/**"], "payment-service")).toBeNull();
    expect(excludingEntry([], "payment-service")).toBeNull();
  });

  it("takes the tree spelled either way, because the repository spells it both ways", () => {
    // `serviceTreePath` includes the `services/` prefix; the entries this
    // module writes are built from the part under it. Answering "not excluded"
    // for every service because a caller passed the other spelling would be
    // silent and total.
    expect(excludingEntry(["services/platform/**"], "services/platform/identity-service")).toBe("services/platform/**");
    expect(excludingEntry(["services/**"], "services/payment-service")).toBe("services/**");
  });
});

describe("excludingPath answers the same question for any document under the docs root", () => {
  // Catches: the architecture loader reading `architecture/` and ignoring the
  // root config. A palette the renderer never loads is a `global style` name the
  // fleet project cannot resolve, and until this matcher existed the generated
  // views referenced it anyway (verification 2026-09-04, W5).
  it("names the entry covering a document, by directory or by filename", () => {
    expect(excludingPath(["architecture/palette.likec4"], "architecture/palette.likec4")).toBe(
      "architecture/palette.likec4",
    );
    expect(excludingPath(["architecture/drafts/**"], "architecture/drafts/x.likec4")).toBe("architecture/drafts/**");
    // Measured: `architecture/*.likec4` hides BOTH documents in that directory,
    // so a `*` inside a segment is a wildcard within the segment.
    expect(excludingPath(["architecture/*.likec4"], "architecture/landscape.likec4")).toBe("architecture/*.likec4");
  });

  it("leaves a document no entry is about alone, and takes the path spelled either way", () => {
    expect(excludingPath(["features/**", "**/node_modules/**"], "architecture/landscape.likec4")).toBeNull();
    expect(excludingPath(["architecture/drafts/**"], "architecture\\drafts\\x.likec4")).toBe("architecture/drafts/**");
    expect(excludingPath(["**/node_modules/**"], "architecture/node_modules/x.likec4")).toBe("**/node_modules/**");
  });

  // The four rules of the measured table, on the fleet the table was measured
  // on. Each expectation is one row: `services/pay` -> 3 files (both payment
  // trees hidden), `architect` -> 3, `*.likec4` -> 0, `services/pay/**` -> 5,
  // `architecture/*.likec4` -> 4 (the nested use case survives, so `*` stays
  // inside one segment).
  it("reproduces the renderer's own file counts, row by row", () => {
    const files = [
      "architecture/landscape.likec4",
      "architecture/usecases/uc.likec4",
      "services/payment-service/model.likec4",
      "services/payments/payment-service/model.likec4",
      "services/order-service/model.likec4",
    ];
    const loaded = (entry: string): number => files.filter((f) => excludingPath([entry], f) === null).length;
    expect(loaded("services/zzz"), "services/zzz").toBe(5);
    expect(loaded("services/pay"), "services/pay").toBe(3);
    expect(loaded("architect"), "architect").toBe(3);
    expect(loaded("*.likec4"), "*.likec4").toBe(0);
    expect(loaded("services/pay/**"), "services/pay/**").toBe(5);
    expect(loaded("architecture/*.likec4"), "architecture/*.likec4").toBe(4);
    expect(loaded("services/*/payment-service"), "services/*/payment-service").toBe(4);
    expect(loaded("ces/payment-service"), "ces/payment-service").toBe(5);
    expect(loaded("**/node_modules/**"), "**/node_modules/**").toBe(5);
  });
});

// The SPELLING table — the second measured table this module answers to, and the
// one that was wrong in loam's favour until the entry was normalised the way the
// renderer normalises it.
//
// MEASURED at the 1.59.2 pin on a copy of `examples/docs` carrying an extra
// `architecture/palette.likec4` (so 9 `.likec4` documents; 10 in the two rows
// that add `architecture-old/old.likec4`), by putting one entry in the root
// `likec4.config.json` beside the scaffold's two and counting the "found N
// source files" line `npx likec4 validate .` prints:
//
//   (no extra entry)                9    architecture                  5 of 10
//   architecture/palette.likec4     8    architecture/                 6 of 10
//   ./architecture/palette.likec4   8    architecture//                6 of 10
//   architecture/./palette.likec4   8    architecture/./               6 of 10
//   architecture//palette.likec4    8    .//architecture/**           10 of 10
//   architecture/**                 5    services\order-service\**     9
//   ./architecture/**               5    services/**/model.likec4      4
//   architecture/./**               5    **/model.likec4               4
//   architecture//**                5    services/*/model.likec4       6
//
// Three rules come out of it. A leading `./`, an inner `/./` and an inner `//`
// are normalised away; a TRAILING `/` is NOT (bare `architecture` also takes
// `architecture-old/`, `architecture/` does not); and `.//` and a backslash each
// leave a pattern that matches nothing at all.

describe("an entry is normalised the way the renderer normalises it, before anything is matched", () => {
  // Catches the defect verbatim: the matcher built its expression from the RAW
  // entry while normalising only the path, so `./architecture/palette.likec4`
  // hid the palette from `likec4 validate` (8 files of 9) and from nothing in
  // loam — the census loaded it, `subsystem sync` wrote `global style
  // subsystems` referencing a group the fleet project cannot resolve, and the
  // run reported 0 errors with every render Invalid.
  it("resolves a leading `./`, an inner `/./` and an inner `//` — one file, four spellings", () => {
    for (const entry of [
      "architecture/palette.likec4",
      "./architecture/palette.likec4",
      "architecture/./palette.likec4",
      "architecture//palette.likec4",
    ]) {
      expect(excludingPath([entry], "architecture/palette.likec4"), entry).toBe(entry);
    }
  });

  it("resolves the same three spellings of a DIRECTORY entry, for a file and for a tree", () => {
    for (const entry of ["architecture/**", "./architecture/**", "architecture/./**", "architecture//**"]) {
      expect(excludingPath([entry], "architecture/landscape.likec4"), entry).toBe(entry);
    }
    for (const entry of ["services/**", "./services/**", "services/./**", "services//**"]) {
      expect(excludingEntry([entry], "payment-service"), entry).toBe(entry);
      expect(excludingEntry([entry], "platform/identity-service"), entry).toBe(entry);
    }
  });

  // The row that says the normalisation is not a blanket one. Stripping the
  // trailing slash would widen `architecture/` into the raw prefix
  // `architecture`, which the renderer measures as a DIFFERENT entry: 5 files of
  // 10 against 6: it takes `architecture-old/old.likec4` too.
  it("keeps a TRAILING slash, because the renderer treats it as a separator it needs", () => {
    expect(excludingPath(["architecture/"], "architecture/landscape.likec4")).toBe("architecture/");
    expect(excludingPath(["architecture/"], "architecture-old/old.likec4")).toBeNull();
    expect(excludingPath(["architecture"], "architecture-old/old.likec4")).toBe("architecture");
    // `architecture//` and `architecture/./` collapse onto `architecture/`, not
    // onto the bare prefix — measured 6 files of 10 for all three.
    for (const entry of ["architecture//", "architecture/./"]) {
      expect(excludingPath([entry], "architecture/landscape.likec4"), entry).toBe(entry);
      expect(excludingPath([entry], "architecture-old/old.likec4"), entry).toBeNull();
    }
  });

  // Measured: 10 files of 10. A `.` followed by a doubled slash survives as a
  // literal directory name, so the pattern names a path nothing on disk has.
  it("reads `.//` as a literal dot directory — it hides nothing", () => {
    expect(excludingPath([".//architecture/**"], "architecture/landscape.likec4")).toBeNull();
    expect(excludingEntry([".//services/**"], "payment-service")).toBeNull();
  });

  // Catches the backslash defect, in BOTH directions. Measured: the entry
  // leaves all 8 documents loaded, because picomatch escapes a backslash to a
  // literal and no separator is ever spelled that way. loam read it as covering
  // the tree, warned `service.model-excluded` about a service the renderer loads
  // perfectly, and `subsystem sync` then DELETED the team's line.
  it("reads a BACKSLASH entry as covering nothing, and as naming no directory", () => {
    const entry = "services\\order-service\\**";
    expect(excludingEntry([entry], "order-service")).toBeNull();
    expect(excludingEntry(["services\\**"], "order-service")).toBeNull();
    expect(excludingPath([entry], "services/order-service/model.likec4")).toBeNull();
    // Never loam's to rewrite either: authorship is about the directory an entry
    // names, and an entry that hides nothing names nothing.
    expect(
      standaloneExclude([entry], {
        standalone: [],
        extending: ["order-service"],
        enumerated: ["order-service"],
      }),
    ).toEqual([entry]);
  });

  // The other half of item 2: a PATH still splits on either slash, because the
  // repository hands this module Windows paths. Only the ENTRY changed.
  it("still takes a path spelled with backslashes, which is where they are real", () => {
    expect(excludingPath(["architecture/drafts/**"], "architecture\\drafts\\x.likec4")).toBe("architecture/drafts/**");
  });

  // The FILE-shaped entry, which covers no directory at all and hides every
  // model. Measured: `services/**/model.likec4` and `**/model.likec4` each leave
  // 4 documents of 8 on `examples/docs`; `services/*/model.likec4` leaves 6,
  // because a single star stays inside one segment.
  it("answers the FILE question for an entry no directory question can see", () => {
    for (const entry of ["services/**/model.likec4", "**/model.likec4"]) {
      expect(excludingPath([entry], "services/order-service/model.likec4"), entry).toBe(entry);
      expect(excludingPath([entry], "services/platform/identity-service/model.likec4"), entry).toBe(entry);
      // And it is NOT a directory answer: `subsystem sync` has no entry to write
      // for half a tree, which is why the finding's message says so.
      expect(excludingEntry([entry], "order-service"), entry).toBeNull();
    }
    expect(excludingPath(["services/*/model.likec4"], "services/order-service/model.likec4")).toBe(
      "services/*/model.likec4",
    );
    expect(excludingPath(["services/*/model.likec4"], "services/platform/identity-service/model.likec4")).toBeNull();
  });
});

describe("readRootExclude reads a file a Windows shell saved", () => {
  // Catches the defect verbatim. PowerShell's `Out-File` writes `ef bb bf` by
  // default on this platform, so saving the very file loam wrote left
  // `JSON.parse` throwing while the renderer went on applying every entry:
  // `npx likec4 validate .` at 3 source files of 8 with `services/**` in force,
  // and loam at "0 errors, 10 warnings", `doctor` healthy, `grep -ci exclude`
  // over the whole run 0 (re-verification 2026-09-04, area C item 3).
  it("strips a leading byte-order mark before parsing", async () => {
    const config = JSON.stringify({ name: "fleet", exclude: ["**/node_modules/**", "services/**"] }, null, 2);
    const fx = await docsWith({ "likec4.config.json": `﻿${config}\n` });
    try {
      expect(await readRootExclude(fx.dir)).toEqual(["**/node_modules/**", "services/**"]);
    } finally {
      await fx.cleanup();
    }
  });

  // The `null` arm is UNCHANGED for a config the renderer rejects on its schema:
  // `"exclude": "services/**"` loads 0 projects out of 1 ("Invalid input:
  // expected array, received string"), and loam saying nothing rather than
  // reading a string as a one-entry list is the honest answer. Measured at the
  // pin and pinned here so a BOM-tolerant reader does not widen into it.
  it("still answers null for an `exclude` that is not a list of strings", async () => {
    const asString = await docsWith({ "likec4.config.json": '{"name":"fleet","exclude":"services/**"}\n' });
    const withBom = await docsWith({ "likec4.config.json": '﻿{"name":"fleet","exclude":"services/**"}\n' });
    try {
      expect(await readRootExclude(asString.dir)).toBeNull();
      expect(await readRootExclude(withBom.dir)).toBeNull();
    } finally {
      await Promise.all([asString.cleanup(), withBom.cleanup()]);
    }
  });
});

describe("standaloneExclude recomputes loam's entries and keeps the team's", () => {
  it("replaces `services/**` with one entry per standalone model, sorted, after the untouched entries", () => {
    const written = standaloneExclude(["**/node_modules/**", "services/**", "features/**"], {
      standalone: ["payment-service", "platform/identity-service"],
      extending: ["order-service"],
      enumerated: ["payment-service", "platform/identity-service", "order-service"],
    });
    expect(written).toEqual([
      "**/node_modules/**",
      "features/**",
      "services/payment-service/**",
      "services/platform/identity-service/**",
    ]);
  });

  it("drops the entry for a service whose model became extending", () => {
    // The whole repair. Left in place, the renderer goes on hiding a model
    // that now parses ONLY inside the root project — a box with nothing in it,
    // and a sync that reported success.
    const written = standaloneExclude(["services/order-service/**", "services/payment-service/**"], {
      standalone: ["payment-service"],
      extending: ["order-service"],
      enumerated: ["order-service", "payment-service"],
    });
    expect(written).toEqual(["services/payment-service/**"]);
  });

  it("keeps a team's own `services/<dir>/**` when <dir> is not a service", () => {
    // `services/legacy/` holding notes, not a service. loam never wrote that
    // entry and must not eat it: the enumeration is what tells the two apart,
    // since an entry cannot say who wrote it.
    const written = standaloneExclude(["services/legacy/**", "services/order-service/**"], {
      standalone: [],
      extending: ["order-service"],
      enumerated: ["order-service"],
    });
    expect(written).toEqual(["services/legacy/**"]);
  });

  it("drops a SUBSYSTEM-WIDE entry that hides an extending model, whoever wrote it", () => {
    // The repair loop that never closed. `services/platform/**` names a
    // directory the enumeration never returns as a service, so the authorship
    // rule leaves it alone — and it hides `services/platform/identity-service`
    // exactly as completely as `services/**` would. `service.model-excluded`
    // warned forever while naming `loam subsystem sync` as the fix, and sync
    // answered `updated: false`.
    const written = standaloneExclude(["**/node_modules/**", "services/platform/**"], {
      standalone: [],
      extending: ["platform/identity-service"],
      enumerated: ["platform/identity-service"],
    });
    expect(written).toEqual(["**/node_modules/**"]);
  });

  it("keeps a covering entry that hides only a NON-service directory, extending models elsewhere", () => {
    // Effect, not spelling: `services/legacy/**` looks exactly like the entry
    // above and hides nothing that has to be visible, so it stays.
    const written = standaloneExclude(["services/legacy/**"], {
      standalone: [],
      extending: ["platform/identity-service"],
      enumerated: ["platform/identity-service"],
    });
    expect(written).toEqual(["services/legacy/**"]);
  });

  it("appends NOTHING for a standalone tree a surviving entry already covers", () => {
    // The entry excludes it correctly, so there is nothing to repair and the
    // line is not loam's to take — and a second entry for the same directory
    // would be a line nobody wrote appearing in a file the team owns. SCHEMA
    // promises exactly this ("a directory the list already covers in any of
    // those spellings earns no second entry"), and the code appended anyway
    // (verification 2026-09-04, review C). If the team narrows their glob
    // tomorrow, `service.model-unexcluded` says so and the next sync writes the
    // entry; a duplicate is un-writable by any command at all.
    const trees = {
      standalone: ["platform/identity-service"],
      extending: ["payment-service"],
      enumerated: ["platform/identity-service", "payment-service"],
    };
    const written = standaloneExclude(["services/platform/**"], trees);
    expect(written).toEqual(["services/platform/**"]);
    expect(standaloneExclude(written, trees)).toEqual(written);
  });

  it("drops an entry that hides an extending model through a WILDCARD segment", () => {
    // The read side named this entry in `service.model-excluded` and pointed at
    // `loam subsystem sync`; the write side asked the effect question through
    // "which directory does this entry name", which answers null for a starred
    // segment — so the entry was kept, unconditionally, forever. Effect is
    // asked through the same matcher the read side uses now.
    expect(
      standaloneExclude(["**/node_modules/**", "services/*/svc-a"], {
        standalone: [],
        extending: ["platform/svc-a"],
        enumerated: ["platform/svc-a"],
      }),
    ).toEqual(["**/node_modules/**"]);
  });

  it("writes nothing about services when the fleet has no standalone model left", () => {
    expect(
      standaloneExclude(["features/**"], {
        standalone: [],
        extending: ["payment-service"],
        enumerated: ["payment-service"],
      }),
    ).toEqual(["features/**"]);
  });

  it("is idempotent — a second sync over its own output changes nothing", () => {
    const trees = {
      standalone: ["payment-service"],
      extending: ["order-service"],
      enumerated: ["payment-service", "order-service"],
    };
    const once = standaloneExclude(["features/**", "services/**"], trees);
    expect(standaloneExclude(once, trees)).toEqual(once);
  });
});
