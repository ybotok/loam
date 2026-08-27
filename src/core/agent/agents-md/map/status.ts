/**
 * The `loam status` entry of the command map — its own section module for
 * `./mcp.ts`'s exact reason: command-map.ts sits against the 300-line limit,
 * so the orientation surface's documentation lives one package down. Unlike
 * its siblings it is not concatenated AFTER the map: status is deliberately
 * the map's FIRST bullet, so ../command-map.ts composes it into COMMAND_MAP
 * between the preamble and the validate entries. The `next.*` fleet and
 * feature codes are what test/codes-drift.test.ts finds here.
 *
 * Same assembly contract as every section: the composition concatenates with
 * NO join separator, so this string starts at the first character of its
 * opening line and ends with the newline that closes its last one.
 */
export const STATUS_COMMAND = `- \`loam status [<FEAT>]\` is the orientation surface — the question you have when
  you join a repository halfway, or come back having lost the session, and the one
  every other command assumed you could already answer. It writes nothing and
  stores nothing: there is no state file, every answer is re-derived from the
  files, so a document someone edited in another window is visible on the next run
  with nothing to invalidate. Artifacts come back as \`missing\` (owed, nothing in
  the way — write it now), \`blocked\` (not written and not writable yet; the entry
  names what comes first), \`draft\` (on disk, and the shared checks report an error
  against it — what exists is wrong), \`ready\` (on disk and clean, but something
  outside the documents — code, a test run, a recording — still has to answer it)
  or \`done\`. The payload's reason to exist is \`next[]\`: ordered, first entry
  first, each carrying a code and the literal command to run. \`next.recover-commit\`
  outranks every other step in both forms and is never elided: a \`.loam-commit\`
  journal says a writer was killed mid-commit, so some of the files everything
  below is derived from may be half-written. Its command is the re-run the
  journal itself names — archive/unarchive repair from the pre-image, every
  other writer rolls its staged bytes forward — under the lock either way;
  except when the journal cannot be read, where it is \`loam doctor\` and the
  repair is a human's comparison against version control. Fleet-wide the rest are
  \`next.adopt-bound\` (this repository's own loam.json names a service the docs repo
  has no directory for at all — it outranks every other service's partial adoption,
  because it is the only step that is about the repo you are standing in, and it is
  the same state \`loam doctor\` reports as \`doctor.service-unknown\`),
  \`next.adopt\` (a service with no spec.md — nothing about it is written down, so
  no feature can be graded against it), \`next.complete-service\` (a living spec.md
  with no model.likec4 beside it), \`next.feature\` (something is in flight;
  ask \`loam status <FEAT>\` about it), \`next.archive\` (authored and verified —
  ship it, and everything waiting on it is released), \`next.fleet-clean\`
  (services exist and nothing is owed — a docs repo with no services and no
  features instead gets the first-hour ladder: \`next.author-landscape\` (the
  fleet map is missing or still the untouched scaffold), \`next.bind-service\`,
  \`next.adopt-first\` — the \`/loam-adopt\` body walks it), \`next.elided\` (the
  fleet list hit its cap and says how many steps of the same kinds it left
  out — it is ordered most-unblocking first, so work down it and re-run) and
  \`next.fleet-gate\` (always last while anything is outstanding:
  \`loam validate --all\` is what CI runs, and the fleet form grades nothing
  itself). On one feature: \`next.author-intent\`, \`next.touch-service\`
  (no per-service delta at all yet), \`next.author-spec\`, \`next.author-openapi\`,
  \`next.author-scenarios\`, \`next.rebase\` (requirements or operations with no
  baseline pin — until they have one the merge cannot tell what it EDITS from what
  it merely quotes), \`next.archive-first\` (another feature in flight has to land
  before this one), \`next.fix-coherence\` (the three axes disagree and archive
  refuses), \`next.generate-tests\` (a per-service delta carries scenarios no test
  run has answered — \`loam gherkin <FEAT> --service <svc>\` in that service's own
  repository), \`next.verify\` (the done-check has not been started — or its record
  will not read, or it answers a checklist the feature has since moved out from
  under, which is not the same as a finished one), \`next.verify-unconfirmed\`
  (started, and claims are still open — close them from each affected service's
  own repository), \`next.attest-service\` (this repo IS one of the services that
  owes an answer, so the step is bound to this commit), \`next.verify-attested\`
  (every claim is confirmed but a scenario rests on an agent's word rather than a
  green run — see "The done-check"), \`next.archive\`, and \`next.archived\` for one
  that shipped.
  It grades nothing of its own: the verdict is the one \`loam validate --feature\`
  and \`loam archive\` compute — status takes the UNION of what both of them refuse,
  so it may be more pessimistic than either and can never be greener than both.
  \`verification\` carries \`verdict\` (\`verified\` | \`attested\` | \`unverified\`)
  and \`attested\` (how many scenario claims rest on an agent's word) beside the
  recounted totals, and \`checks.issues[]\` carries \`gates\` and \`details\` on every
  finding.
`;
