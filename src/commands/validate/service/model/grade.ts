/**
 * How a service's `model.likec4` is GRADED, once `c4/service-model/` has
 * decided how to read it.
 *
 * A package of its own beside `../service.ts` because that module is the ORDER
 * — it reads what more than one axis joins through and pushes findings in the
 * sequence the report is read in — and this is one axis's verdicts. Splitting it
 * out is what let the model gain three arms without the order module gaining
 * any: the four states below are the loader's four, and each one has exactly one
 * right answer here.
 *
 *  - the map is unreadable (an extending model only): NOTHING. The model could
 *    not be read, so neither `c4.invalid` nor `c4.valid` is a claim anybody may
 *    make about it, and blaming N services for one broken document is the
 *    report. `spine.landscape-invalid` already fires per service and gains a
 *    clause saying the model went unread with it (`../spine.ts`).
 *  - errors: `c4.invalid`, exactly as before. For an extending model the details
 *    name the FILE as well as the line, because a duplicate declaration is
 *    reported against the map as well as the model, and a bare `L8:` then points
 *    at somebody else's text.
 *  - clean, and nothing in the map resolves to this directory:
 *    `landscape.service-unmodelled` on the SERVICE target. An extending model
 *    says what is inside an element the map binds; with no such element there is
 *    nothing to be inside, and every count below would be zero for a file full
 *    of architecture.
 *  - clean: `c4.valid`, and one `c4.element-unowned` per element the model
 *    declared outside its own.
 */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { maskSource } from "../../../../core/c4/source-mask.js";
import type { ServiceModel } from "../../../../core/c4/service-model/load.js";
import { serviceResolver } from "../../../../core/c4/resolve/service.js";
import type { LikeC4Error } from "../../../../core/c4/likec4.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import type { PathableService } from "../../../../core/kernel/ids/service.js";
import { ARTIFACT_FILES } from "../../../../core/repo/paths.js";
import type { Finding } from "../../../../core/vocabulary/report.js";
import { errorText } from "../../../../core/c4/likec4.js";

export interface ModelGrade {
  service: PathableService;
  /** Repo-relative, `/`-separated — the directory the map has to bind, named in the unmodelled arm. */
  treePath: string;
  docsDir: DocsDir;
  model: ServiceModel;
  /** Absolute path of `model.likec4` — read only to explain a parse error, see `extendHint`. */
  modelPath: string;
  /** Every service directory that exists — the resolver's positive evidence, exactly as the slice used it. */
  known: ReadonlySet<string>;
  /**
   * How many of this service's own `dynamic view`s carried a reserved tag and
   * were graded (`core/usecases/service/flows.ts`), counted by the caller
   * because the scan is the use-case axis's and this is the model's.
   *
   * It rides on `c4.valid` and nowhere else. A healthy intra-service flow used
   * to be invisible on every loam surface — the axis reports only what is wrong
   * with one — so a team that wrote the slot correctly could not tell it from a
   * team whose views were never read (verification 2026-09-04, D10).
   */
  gradedFlows: number;
}

export async function modelFindings(grade: ModelGrade): Promise<Finding[]> {
  const { service, model } = grade;
  // The map did not parse, so the model was never read. Silence here is the
  // whole point: `spine.landscape-invalid` is the one finding, and it names the
  // map rather than blaming a file nobody opened.
  if (model.mapUnreadable) return [];

  if (model.doc.errors.length > 0) {
    return [
      {
        severity: "error",
        code: "c4.invalid",
        message: `${service}: C4 model has ${model.doc.errors.length} error(s)`,
        // The hint FIRST, the errors after it: `capDetails` keeps the first ten
        // lines and drops the rest, and a model written in both shapes at once
        // stops resolving every kind and every reference in the file — dozens of
        // cascading errors — so appending the one line that diagnoses it put it
        // past the cap in exactly the case it exists for (verification
        // 2026-09-04). It is the diagnosis; the errors are the evidence.
        details: [...(await extendHint(grade)), ...model.doc.errors.map((err) => detail(err, grade))],
      },
    ];
  }

  if (model.shape === "extending" && !mapBindsAnElement(grade)) {
    return [
      {
        severity: "error",
        code: "landscape.service-unmodelled",
        subject: service,
        message:
          `${service}: ${ARTIFACT_FILES.model} extends the fleet map, and no element in ` +
          `architecture/landscape.likec4 resolves to ${grade.treePath}/ — nothing in the model can be graded ` +
          `until the map binds one (metadata { service '${service}' })`,
      },
    ];
  }

  const findings: Finding[] = [
    {
      severity: "ok",
      code: "c4.valid",
      message:
        `${service}: C4 model valid (` +
        (model.shape === "extending" ? "extends the fleet map — " : "") +
        `${model.doc.elements.length} elements · ${model.doc.relationships.length} relationships)` +
        // Outside the parentheses because the counts inside are facts about
        // model.likec4 alone and the flows are read from the whole project.
        (grade.gradedFlows === 0 ? "" : ` · ${grade.gradedFlows} tagged flow(s) graded`),
    },
  ];
  for (const element of model.unowned) {
    findings.push({
      severity: "warn",
      code: "c4.element-unowned",
      subject: service,
      message:
        `${service}: ${ARTIFACT_FILES.model} declares '${element.id}' (${element.kind}) outside this service's ` +
        "own element — an extending model adds elements under the element that resolves to " +
        `${service} only. Three remedies, and the FIRST is the one a store or a component usually ` +
        // The nested arm led the other two from 2026-09-04: a private store's own
        // remedy was missing here, so following what this printed moved a store
        // to fleet level and earned `landscape.service-undocumented` (#01/W8).
        `wants: a store or component this service owns goes INSIDE the \`extend <fqn> { }\` block, ` +
        "where its id becomes `<fqn>.<name>`; a system this service reaches belongs in " +
        "architecture/landscape.likec4, declared once; and another service's internals belong in " +
        "that service's model",
    });
  }
  return findings;
}

/**
 * Does anything in the per-service project resolve to this service?
 *
 * The same question `sliceForService` asks to build `own`, asked again rather
 * than carried on the `ServiceModel`: the slice publishes what a check READS
 * (the elements, the edges, the strays), and "was the set empty" is a fact
 * about the map's bindings rather than a fourth list. Resolved over the
 * PROJECT's elements, because that is the index the slice used and a
 * nearest-ancestor binding must win here exactly as it does there.
 *
 * A standalone model never reaches this: it declares its own elements and
 * answers for them whether or not the map has heard of the directory — the
 * fleet target's own `landscape.service-unmodelled` is where that is said.
 */
function mapBindsAnElement(grade: ModelGrade): boolean {
  const project = grade.model.project;
  if (project === null) return true;
  const resolve = serviceResolver(project.elements, grade.known);
  return project.elements.some((e) => resolve(e.id) === (grade.service as string));
}

/**
 * One parse error, spelled for the shape it came from.
 *
 * A standalone model is one file, so its errors keep the bare `L8: …` form they
 * have always had — every fixture and every reader of that message is pinned to
 * it. An extending model is a PROJECT, and LikeC4 reports a duplicate
 * declaration against BOTH documents: without the file name the reader is sent
 * to a line number in a file they were never told about, which is the exact
 * failure `landscape.invalid` fixed one altitude up.
 */
function detail(err: LikeC4Error, grade: ModelGrade): string {
  if (grade.model.shape === "standalone" || err.sourceFsPath === undefined) return errorText(err);
  return `${relative(grade.docsDir, err.sourceFsPath).split(/[\\/]/).join("/")} ${errorText(err)}`;
}

/** An `extend` in a masked model — the bytes, not a parse, because the parse is what failed. */
const EXTENDS = /\bextend\s+[A-Za-z_][\w.-]*\s*\{/;

/**
 * The one line that explains a model written in BOTH shapes at once.
 *
 * A file declaring an element kind is standalone (SCHEMA.md, "Two shapes of a
 * service model"), so it is parsed alone — and every `extend <fqn>` in it then
 * resolves nothing, because the fqn belongs to a map this load never opened.
 * LikeC4 says `Could not resolve reference to Element named '<fqn>'`, which
 * reads as a typo; nothing said which of the two lines the author has to drop
 * (verification 2026-09-04, D10). Emitted only for the standalone shape, where
 * the diagnosis is certain; an unreadable file adds nothing, since the loader
 * already answered `standalone` for the same reason and `c4.invalid` names it.
 */
async function extendHint(grade: ModelGrade): Promise<string[]> {
  if (grade.model.shape !== "standalone") return [];
  const text = await readFile(grade.modelPath, "utf8").catch(() => null);
  if (text === null || !EXTENDS.test(maskSource(text).code)) return [];
  return [
    `${ARTIFACT_FILES.model} declares an element kind in \`specification { }\`, so it is read as the ` +
      "standalone shape — parsed alone, where `extend` resolves nothing. Drop the kind declaration to " +
      "extend the fleet map, or drop the `extend` and declare the elements here",
  ];
}
