import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "../../core/envelope/config.js";
import { FEATURE_ID_RULE, isFeatureId, parseServiceIds } from "../../core/kernel/ids.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../../core/envelope/json.js";
import { UnsafePathError, resolveInside } from "../../core/kernel/path-safety.js";
import { featureIdFromDirName, nearestIds, type FeatureEntry } from "../../core/repo/entries.js";
import { featuresDir } from "../../core/repo/paths.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { listServices, resolveFeature } from "../../core/repo/repo.js";
import { docsRepoReady, reportDocsRepoError } from "../policy/gate.js";
import {
  archSpecTemplate,
  deltaTemplate,
  intentTemplate,
  openapiTemplate,
  specTemplate,
} from "./templates.js";

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
      // was a writer pointed outside the docs repo. One grammar (core/kernel/ids.ts),
      // the same one adopt/init/vouch refuse on, so a service that is legal to
      // create is legal to name here and nowhere the two disagree.
      // The LIST, not each item: a loop narrows the element and leaves the
      // array unbranded, so what reached the writer below was `string[]` no
      // matter how thoroughly each id had been checked. --touches first, so the
      // id reported first is the one it was before.
      const touches = parseServiceIds(opts.touches, "--touches");
      if (!touches.ok) return fail(json, "invalid-option", touches.problem);
      const newServices = parseServiceIds(opts.newService, "--new-service");
      if (!newServices.ok) return fail(json, "invalid-option", newServices.problem);

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
      const created = new Set(newServices.ids);
      const touched = touches.ids.filter((s) => !created.has(s));
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
