import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { loadConfig } from "../core/config.js";
import { FEATURE_ID_RULE, InvalidIdError, assertServiceId, isFeatureId } from "../core/ids.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../core/json.js";
import { UnsafePathError, resolveInside } from "../core/path-safety.js";
import {
  DocsRepoUnavailableError,
  featureIdFromDirName,
  featuresDir,
  listServices,
  nearestIds,
  resolveFeature,
  type FeatureEntry,
} from "../core/repo.js";
import { docsRepoReady, reportDocsRepoError } from "./docs-repo-gate.js";

interface NewOptions {
  title?: string;
  touches: string[];
  newService: string[];
  json?: boolean;
}

export function registerNew(program: Command): void {
  program
    .command("new")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Scaffold a feature: intent, C4 delta, and a requirement delta per service")
    .option("--title <text>", "human title; also becomes the directory slug")
    // `--touches`, not `--service`: everywhere else `--service` selects the ONE
    // operating target (defaulting to config.service), while this is a repeatable
    // list of services the feature touches — a different arity and a different
    // meaning deserve a different name.
    .option("--touches <id>", "a service this feature touches (repeatable)", collect, [])
    .option("--new-service <id>", "a service this feature introduces (repeatable)", collect, [])
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: NewOptions) => {
      const json = opts.json === true;

      const dirName = featureDirName(featureId, opts.title);
      // The round-trip is checked beside the grammar, not inside it: the
      // grammar is a fact about the id, while `featureIdFromDirName` depends on
      // the TITLE this command is about to slug into the directory name. Only
      // `new` creates that directory, so only `new` owes that second half.
      if (!isFeatureId(featureId) || featureIdFromDirName(dirName) !== featureId) {
        return fail(
          json,
          "invalid-option",
          `'${featureId}' is not a usable feature id. ${FEATURE_ID_RULE}`,
        );
      }

      // Service ids are validated BEFORE the config is even loaded, and long
      // before anything is written: every one of them is interpolated into
      // `specs/<id>/` under the new feature directory, so `--touches ../../x`
      // was a writer pointed outside the docs repo. One grammar (core/ids.ts),
      // the same one adopt/init/vouch refuse on, so a service that is legal to
      // create is legal to name here and nowhere the two disagree.
      for (const [label, ids] of [
        ["--touches", opts.touches],
        ["--new-service", opts.newService],
      ] as const) {
        for (const id of ids) {
          try {
            assertServiceId(id, label);
          } catch (err) {
            if (!(err instanceof InvalidIdError)) throw err;
            return fail(json, "invalid-option", err.message);
          }
        }
      }

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const { docsDir } = config;
      // Before a single file is scaffolded: a docsDir that is not a docs repo is
      // refused, never written into. `features/<id>/**` lands happily in any
      // directory, so without this gate `new` reported `ok: true` over a
      // scaffold that no enumeration downstream will ever see — and a docsDir
      // that is simply absent escaped as `internal` (the enumeration below
      // throws) carrying the very sentence `list` and `show` report as
      // `docs-missing`. See docs-repo-gate.ts's docsRepoReady. `services`, not
      // `docs`: every id named by --touches/--new-service is a claim about
      // `services/<id>/`, and the near-miss note below is computed against that
      // directory, so a run without it is guessing.
      if (!docsRepoReady(json, docsDir, "services")) return;

      let existing: FeatureEntry | null;
      try {
        existing = await resolveFeature(docsDir, featureId, "include");
      } catch (err) {
        // The gate above already refused both broken states, so reaching here
        // means the docs repo went away between that check and this read. Same
        // breach, same two codes — the alternative is a stack trace under
        // `internal` that names neither.
        if (!(err instanceof DocsRepoUnavailableError)) throw err;
        reportDocsRepoError(json, err);
        return;
      }
      if (existing) {
        return fail(
          json,
          "already-exists",
          `Feature '${featureId}' already exists at ${repoPath(docsDir, existing.dir)}.`,
        );
      }

      // A service named both ways is new — that is the more specific claim.
      const created = new Set(opts.newService);
      const touched = opts.touches.filter((s) => !created.has(s));
      const dir = join(featuresDir(docsDir), dirName);

      const files: Record<string, string> = {
        "intent.md": intentTemplate(featureId, opts.title),
        "delta.likec4": deltaTemplate(featureId, touched, [...created]),
      };
      for (const svc of [...touched, ...created]) {
        files[join("specs", svc, "spec.md")] = specTemplate(featureId, svc);
      }
      for (const svc of created) {
        files[join("specs", svc, "openapi.yaml")] = openapiTemplate(svc);
        // The architecture axis is scaffolded only for a service this feature
        // INTRODUCES, because that is the case where `c4.uncovered` will fire
        // the moment the delta is written: a brand-new tagged element nothing
        // covers. Handing an author a blank page for the outbox/retries/alerts
        // requirement is how that axis stays empty across a whole fleet.
        files[join("specs", svc, "arch.spec.md")] = archSpecTemplate(featureId, svc);
      }

      const written: string[] = [];
      for (const [rel, content] of Object.entries(files)) {
        // Belt and braces over the id check above: the id grammar is what makes
        // this safe, and `resolveInside` is what proves it at the moment of the
        // write — including the symlink cases a grammar cannot see.
        let path: string;
        try {
          path = resolveInside(docsDir, join("features", dirName, rel), "feature file");
        } catch (err) {
          if (!(err instanceof UnsafePathError)) throw err;
          return fail(json, "invalid-option", err.message);
        }
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf8");
        written.push(repoPath(docsDir, path));
      }

      const notes = await unknownServiceNotes(docsDir, touched);

      if (json) {
        emitJson({
          feature: featureId,
          path: repoPath(docsDir, dir),
          created: written,
          // Not an error and not a finding: `--touches` on a service that does
          // not exist yet is legal (adopt it later, or say `--new-service`).
          // It is reported because the silent alternative is a feature whose
          // spec delta will never merge into anything.
          notes,
        });
        return;
      }
      console.log(`${featureId} scaffolded at ${repoPath(docsDir, dir)}`);
      for (const w of written) console.log(`  + ${w}`);
      for (const note of notes) console.log(`\n  note: ${note}`);
      console.log(`\nNext: fill in the delta, then \`loam validate --feature ${featureId}\`.`);
      console.log(
        "If this feature changes no architecture, delete delta.likec4 — a requirements-only\n" +
          "feature is complete without it, and an empty `model {}` validates clean too.",
      );
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/* ------------------------------------------------------------------ */
/* Hints                                                               */
/* ------------------------------------------------------------------ */

/**
 * `--touches <id>` naming neither a living `services/<id>/` nor a `--new-service`
 * is almost always a typo, and it is silent by construction: the scaffold writes
 * `specs/<id>/spec.md` happily, `loam validate` grades a delta against a living
 * spec that is not there, and the mistake surfaces at archive time as a service
 * appearing from nowhere. A note, not a refusal — naming a service that will be
 * adopted next week is legitimate — but the near-miss is spelled out, because
 * `order-api` vs `orders-api` is exactly the pair a person cannot see.
 */
async function unknownServiceNotes(docsDir: string, touched: string[]): Promise<string[]> {
  if (touched.length === 0) return [];
  let known: string[];
  try {
    known = (await listServices(docsDir)).map((s) => s.id);
  } catch (err) {
    // No docs repo to compare against is a different diagnosis entirely, and
    // `loam doctor` owns it. Saying nothing here beats inventing a typo hint
    // out of an enumeration that never ran.
    if (!(err instanceof DocsRepoUnavailableError)) throw err;
    return [];
  }
  const notes: string[] = [];
  for (const id of touched) {
    if (known.includes(id)) continue;
    const near = nearestIds(id, known);
    notes.push(
      `--touches '${id}' matches no services/${id}/ in the docs repo` +
        (near.length === 0 ? "" : ` — did you mean ${near.map((n) => `'${n}'`).join(" or ")}?`) +
        ` If ${id} is introduced by this feature, pass --new-service ${id} instead.`,
    );
  }
  return notes;
}

/* ------------------------------------------------------------------ */
/* Naming                                                              */
/* ------------------------------------------------------------------ */

function featureDirName(featureId: string, title: string | undefined): string {
  const slug = slugify(title ?? "");
  return slug ? `${featureId}-${slug}` : featureId;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A LikeC4 identifier for a service name: `payment-split-service` -> `paymentSplitService`. */
function identifier(name: string, taken: Set<string>): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter((p) => p.length > 0);
  const head = (parts[0] ?? "svc").replace(/^\d+/, "") || "svc";
  const base =
    head[0]!.toLowerCase() +
    head.slice(1) +
    parts.slice(1).map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}${n}`;
  taken.add(id);
  return id;
}

/** `FEAT-101` -> `feat_101`: LikeC4 view names take no dashes. */
function viewName(featureId: string): string {
  return featureId.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

function intentTemplate(featureId: string, title: string | undefined): string {
  const heading = title ?? featureId;
  // The frontmatter is SERIALIZED, never interpolated. A title is free text a
  // person types — `Checkout: split payments` used to be pasted straight after
  // `title: `, where the colon reopens the mapping and the file stops parsing;
  // `Orders #42 rework` lost everything from the `#` as a YAML comment, so the
  // feature quietly answered to a title nobody wrote. The yaml serializer is the
  // only thing that knows every case, and it is already how migrate-openspec
  // writes the same three keys.
  //
  // `owner` is deliberately NOT a key here. Scaffolding `owner:` writes an
  // explicit null, which is a claim ("this feature has no owner") rather than
  // the truth ("nobody has said yet") — and every reader then has to tell an
  // absent key from a null one. The prompt survives as a comment.
  const frontmatter = stringifyYaml(
    { feature: featureId, ...(title === undefined ? {} : { title }), status: "proposed" },
    { lineWidth: 0 },
  ).trimEnd();
  return `---
${frontmatter}
# owner: <the team or person who answers for this>
---

# ${heading}

## Why

<!-- The problem in business terms. This is what a reviewer reads first, and what
     the requirement deltas below have to be justified by. -->

## Scope

<!-- Which services this touches — and, more usefully, which it deliberately does not. -->
`;
}

function deltaTemplate(featureId: string, touched: string[], created: string[]): string {
  const taken = new Set<string>();
  const touchedIds = touched.map((s) => [identifier(s, taken), s] as const);
  const createdIds = created.map((s) => [identifier(s, taken), s] as const);

  const lines: string[] = [];
  if (touchedIds.length > 0) {
    // Context elements ship COMMENTED OUT, exactly like the example edge below.
    // Declared-and-untagged is the one shape `delta.nothing-tagged` exists to
    // refuse (an author who forgot the tags), so writing these live made every
    // `loam new --touches X` fail its own validator on the very first run —
    // which teaches people that the validator is noise. Uncomment a line when an
    // edge below actually needs the identifier.
    lines.push("  // Services this feature touches, as context for the diagram. Uncomment the");
    lines.push("  // ones an edge below names, and reuse the identifiers from");
    lines.push("  // architecture/landscape.likec4 so the merge lines up. They stay UNTAGGED:");
    lines.push(`  // only #${featureId} is the change, and everything else here is context.`);
    for (const [id, name] of touchedIds) lines.push(`  // ${id} = softwareSystem '${name}'`);
    lines.push("");
  }
  if (createdIds.length > 0) {
    lines.push("  // Services this feature introduces. The tag is what `loam archive` folds");
    lines.push("  // into the living landscape.");
    for (const [id, name] of createdIds) {
      lines.push(`  ${id} = softwareSystem '${name}' {`);
      lines.push(`    #${featureId}`);
      lines.push(`    description 'TODO — what this service owns'`);
      lines.push("  }");
    }
    lines.push("");
  }

  // The example edge uses identifiers already declared above when there are two
  // to join; otherwise placeholders, so it never invents a service.
  const from = touchedIds[0]?.[0] ?? createdIds[0]?.[0] ?? "consumer";
  const to = createdIds[0]?.[0] ?? touchedIds[1]?.[0] ?? "provider";
  lines.push("  // New calls. `metadata { op }` is the spine: it names the OpenAPI operationId");
  lines.push("  // the call uses, and `loam validate` checks it against the target's contract.");
  lines.push("  // Uncomment and adjust (both endpoints have to be declared above):");
  lines.push("  //");
  lines.push(`  // ${from} -> ${to} 'Calls createSplit' {`);
  lines.push(`  //   #${featureId}`);
  lines.push("  //   metadata { op 'createSplit' }");
  lines.push("  // }");

  return `// ${featureId} — architecture delta.
//
// Everything tagged #${featureId} is exactly what \`loam archive\` folds into
// architecture/landscape.likec4. Everything else here is context for the diagram.
//
// If ${featureId} changes no architecture, DELETE this file: a requirements-only
// feature is complete without it, and an empty \`model {}\` is just as legal.

specification {
  element softwareSystem
  tag ${featureId}
}

model {
${lines.join("\n")}
}

views {
  view ${viewName(featureId)} {
    include *
  }
}
`;
}

function specTemplate(featureId: string, service: string): string {
  return `# ${service} — requirement delta for ${featureId}

<!-- Sections: ADDED / MODIFIED / REMOVED. Delete the ones you do not need.
     A MODIFIED requirement carries its full new text, not a diff.
     Every requirement needs at least one scenario — \`loam validate\` gates on it. -->

## ADDED Requirements

### Requirement: TODO — name the behaviour
Requirement-ID: ${featureId}.${service}.requirement

The service SHALL <observable behaviour, testable without reading the code>.

<!-- Operations: createSplit
     The operationIds this requirement governs. \`loam validate\` checks each one
     against the service's OpenAPI, and \`loam archive\` refuses to merge a
     requirement that governs an operation nobody defines. Uncomment when the
     contract exists. -->

#### Scenario: TODO — name the case
- **Given** <the starting state>
- **When** <the trigger>
- **Then** <the observable outcome>
`;
}

/**
 * The architecture axis, scaffolded EMPTY on purpose.
 *
 * Same grammar as spec.md, so the template body has to be unparseable as
 * requirements or the scaffold would ship a requirement nobody wrote — the
 * headings are therefore indented inside an HTML comment, which puts them past
 * the line-anchored `## ADDED Requirements` / `### Requirement:` patterns
 * core/spec.ts matches on. Copy the block out of the comment and unindent it.
 */
function archSpecTemplate(featureId: string, service: string): string {
  return `# ${service} — architecture requirement delta for ${featureId}

<!-- The architecture axis: the obligations no business scenario was ever going
     to mention — the outbox, the retries, the timeouts, the alerts.

     \`Covers:\` is to an arch requirement what \`Operations:\` is to a business
     one — it names the MODEL OBJECTS the scenarios below exercise, so coverage
     is derived instead of trusted. Three forms, comma-separated:

       Covers: ${service}                 a C4 element — its id, or the service a
                                          bound/titled element stands for
       Covers: consumer -> ${service}     an edge, each side resolved the same way
       Covers: alert:<id>, sli:<id>       a signal declared in health.yaml

     Every tagged element and edge in delta.likec4 wants one (\`c4.uncovered\`).
     Delete this file if ${featureId} adds no architectural obligation.

     Copy the block below out of this comment and unindent it:

    ## ADDED Requirements

    ### Requirement: TODO — name the architectural obligation
    Requirement-ID: ${featureId}.${service}.arch

    The service SHALL <the operational/integration behaviour, observable in test>.

    Covers: ${service}

    #### Scenario: TODO — name the case
    - **Given** <the starting state>
    - **When** <the trigger>
    - **Then** <the observable outcome>
-->
`;
}

function openapiTemplate(service: string): string {
  return `openapi: 3.1.0
info:
  title: ${service}
  version: "0.1"

# The operations this feature adds. \`operationId\` is the token the C4 edge
# (metadata { op }) and the requirement (Operations:) both point at — keep the
# three spellings identical or \`loam validate\` will say so.
paths: {}
#  /splits:
#    post:
#      operationId: createSplit
#      responses:
#        "201":
#          description: Created
`;
}
