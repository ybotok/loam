/**
 * Where one service stands on the adoption ladder, as the fleet form of
 * `loam status` asks it — two predicates, and the steps each service owes
 * (`perServiceSteps`). The predicates lived in `../report.ts` among the
 * report's types, which is where the feature report's shape needed the room;
 * the steps lived in `./next.ts` until that file reached its line limit, and
 * they are this subject rather than that one: `./next.ts` orders the whole
 * repository's list, and every rung below is a question about one service.
 * Both `./fleet.ts` (the uncapped `serviceSteps`) and `./next.ts` (the capped
 * list) read them from here.
 */
import { serviceTreePath } from "../../kernel/ids/dirs.js";
import type { ServiceEntry } from "../../repo/entries.js";
import type { NextStep } from "../report.js";

/** Nothing is written down: no living spec at all. Every other absence is partial adoption. */
export function undocumented(s: ServiceEntry): boolean {
  return !s.has.spec;
}

/** A person stamped it — `loam vouch`'s exact postcondition, read back off the frontmatter. */
export function vouched(s: ServiceEntry): boolean {
  return s.status === "verified" && s.sources.stamped;
}

/**
 * Every per-service rung, in the order the list prints them: the bound
 * service's own first, then the rest alphabetically. Exported because the
 * same list, uncapped and grouped (`groupServiceSteps`), rides beside `next[]`
 * as `serviceSteps` — one derivation, so the two can never disagree about
 * what a service owes.
 */
export function perServiceSteps(services: ServiceEntry[], adoptedBinding: string | null): NextStep[] {
  // The per-service rungs are collected as one list because the partition
  // below acts on them as a group — and only on them. Where the list goes is
  // the caller's: `fleetNext` puts it after every feature, and nothing here may
  // float above `next.adopt-bound` or the first-hour ladder, both of which are
  // about the repository rather than about any one service in the fleet.
  const perService: NextStep[] = [];
  // `adoption: partial` is one feature's slice archived into a service never
  // adopted (SCHEMA.md); the file's presence used to discharge this rung.
  for (const s of services.filter((x) => undocumented(x) || x.adoption !== null)) {
    perService.push({
      code: "next.adopt",
      statement: undocumented(s)
        ? `${serviceTreePath(s)}/ has no spec.md — nothing about ${s.id} is written down, so no feature can be graded against it.`
        : `${serviceTreePath(s)}/spec.md is adoption: partial — it holds what an archived feature added, nothing of what ${s.id} already did.`,
      command: `loam adopt --service ${s.id} --json`,
      service: s.id,
    });
  }

  // Adoption does not end at spec.md. A service with a living spec and no
  // model.likec4 is the state archive itself warns about (`service.no-model`)
  // and the fleet gate reports — invisible here until now, because this form
  // looked at exactly one bit of each service's artifact set.
  for (const s of services.filter((x) => !undocumented(x) && x.adoption === null && !x.has.model)) {
    perService.push({
      code: "next.complete-service",
      statement: `${serviceTreePath(s)}/ has a spec.md but no model.likec4 — the fleet gate reports the service incomplete until something models it.`,
      command: `loam validate --service ${s.id} --json`,
      service: s.id,
    });
  }

  // A vouch the document has moved out from under. `content.stale` needs
  // nothing but the document, so unlike `sources.stale` this form CAN see it —
  // and before it looked, a fleet whose specs were edited after the person read
  // them got `next.fleet-clean`: "nothing is owed" over words nobody had
  // re-read, while `loam validate` warned about each one. The re-vouch is a
  // person's act from that service's own repository (`loam vouch` restamps the
  // code side too), so the step names the documents and that repository, and
  // its execution contract is a human review rather than a command to run.
  for (const s of services.filter((x) => vouched(x) && x.contentStale.length > 0)) {
    const files = s.contentStale.map((file) => `${serviceTreePath(s)}/${file}`);
    perService.push({
      code: "next.revouch",
      statement:
        `${files.join(" and ")} changed since ${s.id} was vouched — \`status: verified\` stands over words nobody has re-read (content.stale). ` +
        `A person re-reads what moved (\`loam vouch --pack --service ${s.id}\` lists it) and re-vouches from ${s.id}'s own repository.`,
      command: `loam vouch --service ${s.id}`,
      service: s.id,
    });
  }

  // The boundary this repository IS comes first among the boundaries it merely
  // shares a fleet with. A stable PARTITION and deliberately not a sort: the
  // bound service's rungs move to the front and every other service keeps the
  // alphabetical order it already had, so the list an unbound reader sees — a
  // docs repo, CI, `loam validate --all`'s scorecard — is byte-for-byte the one
  // it saw before.
  //
  // The cap is why this is ordering and not cosmetics. Ten steps print, and in
  // the ten-repo case WORKFLOW.md describes every developer's `loam status`
  // listed nine other services' adoption work ahead of their own; past ten
  // services the one rung this developer can actually act on was elided
  // entirely, leaving a list of nothing but other people's boundaries under
  // the heading "next". No new code is emitted for any of this — `next[]` has
  // always been documented as most-unblocking first, and this is the line that
  // makes the claim true from where the reader is standing.
  return adoptedBinding === null
    ? perService
    : [
        ...perService.filter((s) => s.service === adoptedBinding),
        ...perService.filter((s) => s.service !== adoptedBinding),
      ];
}
