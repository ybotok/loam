import type { Command } from "commander";
import { type PlannedWrite } from "../../core/staging/writes.js";
import { commitScaffold } from "./commit.js";
import { join } from "node:path";
import { loadConfig } from "../../core/envelope/config.js";
import { type FeatureId, parseFeatureId } from "../../core/kernel/ids/feature.js";
import { parseServiceIds } from "../../core/kernel/ids/service.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../../core/envelope/json.js";
import { UnsafePathError, resolveInside } from "../../core/kernel/path-safety.js";
import { featureIdFromDirName, nearestIds } from "../../core/repo/entries.js";
import { featuresDir } from "../../core/repo/paths.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { listServices } from "../../core/repo/repo.js";
import { docsRepoReady, reportDocsRepoError } from "../policy/gate.js";
import { sayRecovered } from "../policy/format.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { capabilityIdProblem } from "../../core/kernel/ids/capability.js";
import { capabilityNotes } from "../../core/capabilities/authoring/notes.js";
import {
  archSpecTemplate,
  capabilityDeltaTemplate,
  deltaTemplate,
  intentTemplate,
  openapiTemplate,
  specTemplate,
} from "./templates.js";

interface NewOptions {
  title?: string;
  touches: string[];
  newService: string[];
  capability: string[];
  json?: boolean;
}

export function registerNew(program: Command): void {
  program
    .command("new")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Scaffold a feature: intent, C4 delta, a requirement delta per service, a capability delta per promise")
    .option("--title <text>", "human title; also becomes the directory slug")
    // `--touches`, not `--service`: everywhere else `--service` selects the ONE
    // operating target (defaulting to config.service), while this is a repeatable
    // list of services the feature touches — a different arity and a different
    // meaning deserve a different name.
    .option("--touches <id>", "a service this feature touches (repeatable)", collect, [])
    .option("--new-service <id>", "a service this feature introduces (repeatable)", collect, [])
    // The INVERSION of the two flags above, and it composes with them rather
    // than excluding them. `--touches` asks which services change before the
    // business change has been written; `--capability` opens the document that
    // changes and lets the service work be derived from it. A feature that
    // does both — the analyst writes the promise, and one team already knows it
    // owns part of the mechanism — is an ordinary shape, and refusing the
    // combination would fight this axis's own archive gate: `capability.uncovered`
    // refuses a promise nothing in the same feature keeps, so the fix it names
    // is precisely a `--touches` service's `Realizes:` line living beside the
    // capability delta.
    //
    // Repeatable, like both flags above: a business change that moves two
    // promises is as real as a feature touching two services, and the flag that
    // is not repeatable is the one that sends an author to mkdir by hand.
    .option("--capability <id>", "a business capability this feature changes (repeatable)", collect, [])
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: NewOptions) => {
      const json = opts.json === true;

      // The grammar's verdict arrives as the brand: `featureDirName` demands
      // a FeatureId, so an argv string cannot reach the directory derivation
      // without passing through this parse — the producer the brand was
      // missing while `isFeatureId` narrowed to plain string.
      const parsedId = parseFeatureId(featureId, "feature id");
      if (!parsedId.ok) {
        return fail(json, "invalid-option", parsedId.problem);
      }
      const dirName = featureDirName(parsedId.id, opts.title);
      // The round-trip is checked beside the grammar, not inside it: the
      // grammar is a fact about the id, while `featureIdFromDirName` depends on
      // the TITLE this command is about to slug into the directory name. Only
      // `new` creates that directory, so only `new` owes that second half.
      if (featureIdFromDirName(dirName) !== featureId) {
        return fail(
          json,
          "invalid-option",
          `'${featureId}' does not survive the directory round-trip with this title.`,
        );
      }

      // Service ids are validated BEFORE the config is even loaded, and long
      // before anything is written: every one of them is interpolated into
      // `specs/<id>/` under the new feature directory, so `--touches ../../x`
      // was a writer pointed outside the docs repo. One grammar (core/kernel/ids/service.ts),
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

      // Same reasoning as the two lists above, one tree over. A capability id
      // becomes `features/<dirName>/capabilities/<id>/` — a chain of
      // directories, one per `/`-separated segment — so `--capability
      // ../../evil` resolves to `features/evil/spec.md`, a directory
      // `listFeatures` then enumerates as a feature, and one `..` further
      // reaches the docs-repo root. `resolveInside` below cannot refuse either:
      // both are still inside the repo. Checked here for that reason, and
      // against the same directory-name grammar a service id passes
      // (core/kernel/ids/capability.ts).
      const capabilities = opts.capability;
      for (const id of capabilities) {
        const problem = capabilityIdProblem(id);
        if (problem !== null) return fail(json, "invalid-option", problem);
      }

      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
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

      // No unlocked existence fast-path, deliberately: staging creates the
      // feature directory at plan time, so a HALF-scaffold from a killed run
      // resolves like a finished feature — and an unlocked refusal here made
      // \`loam new <id>\` answer already-exists over its own wreckage without
      // ever reaching the recovery that would complete it, while doctor's fix
      // printed exactly that re-run. Existence is asked once, under the lock,
      // after recovery has run.

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
      // The business axis, and the ONE file `--capability` adds. No service
      // spec rides with it, and that is the inversion rather than an omission:
      // the whole point of opening the document that changes first is that the
      // services realizing it are not known until the promise is written.
      // `--touches` is still how a service the author already knows about gets
      // its delta, which is why the two compose.
      //
      // Spelled relative, mirroring `featureCapabilityDeltasDir` +
      // `capabilityDocPathsAt` in core/repo/authored/paths.ts — the path builders take a
      // FeatureDir, whose provenance is an enumeration that read the directory,
      // and this directory is about to be created rather than read. One
      // directory per segment, exactly as the living tree spells nesting.
      for (const cap of capabilities) {
        files[join("capabilities", ...cap.split("/"), "spec.md")] = capabilityDeltaTemplate(featureId, cap);
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

      // The COMPLETE plan in memory before a byte lands on disk: every path
      // resolved (belt and braces over the id grammar — resolveInside proves
      // containment at the moment of the write, symlink cases included), and
      // every write an exclusive create, because the feature must not exist.
      // The sequential writeFile loop this replaces could die mid-scaffold and
      // leave a partial feature the next run refused as already-exists.
      const writes: PlannedWrite[] = [];
      for (const [rel, content] of Object.entries(files)) {
        let path: string;
        try {
          path = resolveInside(docsDir, join("features", dirName, rel), "feature file");
        } catch (err) {
          if (!(err instanceof UnsafePathError)) throw err;
          return fail(json, "invalid-option", err.message);
        }
        writes.push({ path, content, exclusive: true });
      }

      const committed = await commitScaffold(docsDir, featureId, writes);
      if (!committed.ok) {
        if ("repoGone" in committed) {
          reportDocsRepoError(json, committed.repoGone);
          return;
        }
        if (committed.code === "already-exists") {
          // After a recovery the refusal must SAY the repair happened: doctor
          // told the operator to re-run this exact command, and "already
          // exists" alone reads as the fix having failed.
          return fail(
            json,
            "already-exists",
            `Feature '${featureId}' already exists at ${repoPath(docsDir, committed.existing?.dir ?? dir)}.` +
              (committed.recovered === null ? "" : ` (${sayRecovered(committed.recovered)} The scaffold is complete.)`),
          );
        }
        return fail(json, committed.code, committed.message);
      }
      const recovered = committed.recovered;
      const written = writes.map((w) => repoPath(docsDir, w.path));

      // Both note families in ONE list, and the services first so an existing
      // `--touches` consumer reads the same first element it always did. They
      // are the same kind of statement — "the thing you named is not there yet,
      // and here is what that means" — so splitting them into two payload keys
      // would ask a consumer to learn a second shape for one idea.
      const notes = [
        ...(await unknownServiceNotes(docsDir, touched)),
        ...(await capabilityNotes(docsDir, { dirName, ids: capabilities })),
      ];

      if (json) {
        emitJson({
          command: "new",
          feature: featureId,
          path: repoPath(docsDir, dir),
          created: written,
          ...(recovered === null ? {} : { recovered }),
          // Not an error and not a finding: `--touches` on a service that does
          // not exist yet is legal (adopt it later, or say `--new-service`),
          // and `--capability` on a promise nobody has named is the ordinary
          // way a new business area starts. Both are reported because the
          // silent alternative is a delta that will never merge into anything,
          // or a near-miss spelling filed as a second capability.
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
async function unknownServiceNotes(docsDir: DocsDir, touched: string[]): Promise<string[]> {
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

function featureDirName(featureId: FeatureId, title: string | undefined): string {
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
