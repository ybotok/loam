import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, reportNoConfig } from "../core/json.js";
import { repoPath } from "./list.js";
import { featureIdFromDirName, featuresDir, resolveFeature } from "../core/repo.js";

/**
 * Feature ids are `<word>-<number>`: the id has to survive being read back off
 * the directory name (FEAT-101-payment-splitting -> FEAT-101), or the feature
 * would answer to a name it was never given.
 */
const ID_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

interface NewOptions {
  title?: string;
  service: string[];
  newService: string[];
  json?: boolean;
}

export function registerNew(program: Command): void {
  program
    .command("new")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Scaffold a feature: intent, C4 delta, and a requirement delta per service")
    .option("--title <text>", "human title; also becomes the directory slug")
    .option("--service <id>", "a service this feature touches (repeatable)", collect, [])
    .option("--new-service <id>", "a service this feature introduces (repeatable)", collect, [])
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: NewOptions) => {
      const json = opts.json === true;

      const dirName = featureDirName(featureId, opts.title);
      if (!ID_RE.test(featureId) || featureIdFromDirName(dirName) !== featureId) {
        return fail(
          json,
          "invalid-option",
          `'${featureId}' is not a usable feature id. Expected <word>-<number>, e.g. FEAT-101 or BUG-42.`,
        );
      }

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const { docsDir } = config;

      const existing = await resolveFeature(docsDir, featureId, { includeArchived: true });
      if (existing) {
        return fail(
          json,
          "already-exists",
          `Feature '${featureId}' already exists at ${repoPath(docsDir, existing.dir)}.`,
        );
      }

      // A service named both ways is new — that is the more specific claim.
      const created = new Set(opts.newService);
      const touched = opts.service.filter((s) => !created.has(s));
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
      }

      const written: string[] = [];
      for (const [rel, content] of Object.entries(files)) {
        const path = join(dir, rel);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf8");
        written.push(repoPath(docsDir, path));
      }

      if (json) {
        emitJson({ feature: featureId, path: repoPath(docsDir, dir), created: written });
        return;
      }
      console.log(`${featureId} scaffolded at ${repoPath(docsDir, dir)}`);
      for (const w of written) console.log(`  + ${w}`);
      console.log(`\nNext: fill in the delta, then \`loam validate --feature ${featureId}\`.`);
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
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
  return `---
feature: ${featureId}
${title ? `title: ${title}\n` : ""}status: proposed
owner:                       # the team or person who answers for this
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
    lines.push("  // Services this feature touches. Reuse the identifiers from");
    lines.push("  // architecture/landscape.likec4 so the merge lines up.");
    for (const [id, name] of touchedIds) lines.push(`  ${id} = softwareSystem '${name}'`);
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
  lines.push("  // Uncomment and adjust:");
  lines.push("  //");
  lines.push(`  // ${from} -> ${to} 'Calls createSplit' {`);
  lines.push(`  //   #${featureId}`);
  lines.push("  //   metadata { op 'createSplit' }");
  lines.push("  // }");

  return `// ${featureId} — architecture delta.
//
// Everything tagged #${featureId} is exactly what \`loam archive\` folds into
// architecture/landscape.likec4. Everything else here is context for the diagram.

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
