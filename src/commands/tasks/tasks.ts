/**
 * `loam tasks` — the third rendering of one ledger, and a pure read.
 *
 * `loam verify` answers "answered by whom". `loam status` answers "which
 * artifact is at which rung". This answers the question an implementer actually
 * holds: what is still open, at which step, and what closes it. Nothing is
 * written, nothing is cached, and there is no state that says a unit is
 * finished — done is "the unit no longer appears", so the list cannot be
 * falsified by editing a checkbox. Everything in it re-derives from the tree, so
 * an orchestrator can ask again and compare rather than trusting a report.
 *
 * THE DOCS-REPO GATE IS DELIBERATELY ABSENT, following `loam delta` rather than
 * `loam verify`. This command is delta's sibling — a projection of ONE feature's
 * own documents — and its first act is `resolveFeature`, whose enumeration
 * carries the docs-repo precondition itself. Adding `docsRepoReady(json, …,
 * "services")` here would also refuse a features-only docs repo that `delta`
 * reads perfectly well today, which would be a new gate wearing the clothes of a
 * new command.
 */
import type { Command } from "commander";
import { configOrRefuse, emitJson, fail } from "../../core/envelope/json.js";
import { InvalidIdError, assertServiceId } from "../../core/kernel/ids/service.js";
import { livingServices } from "../../core/projection/arch-slice.js";
import { nearestIds } from "../../core/repo/entries.js";
import { missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { packetByReference, workPacket, type ReferencedPacket, type WorkPacket } from "../../core/tasks/packet.js";
import { NotUtf8DocumentError } from "../../core/kernel/document-bytes.js";
import { renderNext, renderPacket } from "./render.js";

interface TasksOptions {
  service?: string;
  next?: boolean;
  intentRef?: boolean;
  json?: boolean;
}

export function registerTasks(program: Command): void {
  program
    .command("tasks")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("What is still open on a feature, at which step, and what closes each unit — read-only")
    .option("--service <id>", "narrow the packet to the units one service owns (a lens: no binding needed)")
    .option("--next", "the frontier head alone — the single leaf to hand to a worker")
    .option("--intent-ref", "carry the intent by reference — path, sha256, size, outline and the lines of the open questions naming these units' services — instead of verbatim")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: TasksOptions) => {
      const json = opts.json === true;
      const config = await configOrRefuse(json);
      if (config === null) return;

      // The id grammar first, and on the RAW argument, exactly as `loam delta`
      // does: `--service ../../etc` reaches `featureSpecPaths` and reads from
      // outside the feature directory. One grammar for the whole tool.
      if (opts.service !== undefined) {
        try {
          assertServiceId(opts.service, "--service");
        } catch (err) {
          if (!(err instanceof InvalidIdError)) throw err;
          fail(json, "invalid-option", err.message);
          return;
        }
      }

      // "exclude", so an ARCHIVED feature gets the shared missing-feature
      // message rather than a packet. This is refusal by honesty: archive merges
      // a feature's operations into the living contracts, so a re-derived
      // checklist over an archived feature mismatches BY CONSTRUCTION — every
      // api.exposes claim it once made now reads as already-living and is never
      // minted. A packet over that is not a short list, it is an invented one.
      // `loam verify <id>` still reads the frozen record, and the message says so.
      const feature = await resolveFeature(config.docsDir, featureId, "exclude");
      if (!feature) {
        fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureId));
        return;
      }

      // Only the flag's lens is passed. Without one, the packet narrows itself to
      // the bound service when the feature touches it (`lensOf` in
      // core/tasks/packet.ts says why, and why it is decided there), and
      // `packet.service` is what reports the lens actually applied.
      const lens = opts.service ?? null;
      const packet = await workPacket({
        docsDir: config.docsDir,
        feature,
        lens,
        // `config.root`, never the cwd: loam.json discovery walks upward, and a
        // run from `src/deep/` must read the same generated suite as one from
        // the root. The same reasoning `loam gherkin` records for its writes.
        binding: {
          repoDir: config.root ?? process.cwd(),
          ...(config.service === undefined ? {} : { service: config.service }),
          ...(config.gherkinDir === undefined ? {} : { gherkinDir: config.gherkinDir }),
        },
      });

      // The lens is checked AFTER the derivation, and on the packet's own
      // service list, because that list is the feature's claim subjects — which
      // includes a service the C4 delta introduces and no `specs/` directory
      // names. Checking first would need a second LikeC4 parse of the same
      // delta to learn the same answer. A typo must never be indistinguishable
      // from a finished service: `--service paymnt-service` produces a
      // perfectly plausible EMPTY packet, and an agent reads that as "nothing
      // to do here". Only an EXPLICIT lens is checked: the bound service is
      // applied only when the packet already lists it, so it cannot be a typo.
      if (lens !== null && !packet.services.includes(lens)) {
        const living = await livingServices(config.docsDir);
        if (!living.includes(lens)) {
          const near = nearestIds(lens, [...new Set([...packet.services, ...living])]);
          fail(
            json,
            "unknown-target",
            `No service '${lens}': it is neither a services/${lens}/ in the docs repo nor a service ${feature.id} touches` +
              (packet.services.length === 0 ? "" : ` (${packet.services.join(", ")})`) +
              (near.length === 0 ? "." : ` — did you mean ${near.map((n) => `'${n}'`).join(" or ")}?`),
          );
          return;
        }
      }

      // A feeder that could not be read empties the packet, and an agent
      // consuming this as a task list reads an empty packet as "nothing to do":
      // the vacuously-green pattern `loam delta` guards against on the same
      // three documents. The payload stays as informative as ever and `ok`
      // stays true under --json — the command ran — and the exit code is what
      // stops a pipeline from building on it. Set BEFORE the format fork: the
      // guard is about the documents, not about how they are rendered.
      const blind = Object.keys(packet.unreadable).length > 0;
      if (blind) process.exitCode = 1;

      const shown = opts.next === true ? leaf(packet) : packet;
      if (json) {
        // After the leaf is cut, so the questions the reference keeps are the
        // ones naming the unit a worker is actually handed.
        let payload: WorkPacket | ReferencedPacket = shown;
        if (opts.intentRef === true) {
          try {
            payload = await packetByReference(shown, config.docsDir, feature);
          } catch (err) {
            // `loam context`'s answer for the same file, and `loam gherkin`'s
            // code: a reference to an intent nobody could read would say "no
            // open questions for you" about it.
            if (!(err instanceof NotUtf8DocumentError)) throw err;
            fail(json, "repository-unavailable", `Cannot carry the intent by reference: ${err.message}`);
            return;
          }
        }
        emitJson({ command: "tasks", ...payload });
        return;
      }
      const view = { explicitLens: opts.service !== undefined, bound: config.service };
      if (opts.next === true) renderNext(shown, view);
      else renderPacket(shown, view);
    });
}

/**
 * The leaf packet: the same payload with `units` narrowed to the frontier head.
 *
 * Everything else is left whole on purpose — the counts, the frontier and the
 * review notes are the context that stops a cheap model handed one unit from
 * believing it is the whole job. An empty `units` when nothing is open is the
 * honest answer and not an error: the feature's open work is done, or the
 * record says why the packet cannot see it.
 */
function leaf(packet: WorkPacket): WorkPacket {
  const head = packet.frontier[0];
  return { ...packet, units: packet.units.filter((unit) => unit.id === head) };
}
