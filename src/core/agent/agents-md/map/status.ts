/**
 * The `loam status` entry of the command map — its own section module for
 * `./mcp.ts`'s exact reason: command-map.ts sat against the file-line limit,
 * so the orientation surface's documentation lives one package down. Unlike
 * its siblings it is not concatenated AFTER the map: status is deliberately
 * the map's FIRST bullet, so ../command-map.ts composes it into COMMAND_MAP
 * between the preamble and the validate entries. The `next.*` fleet and
 * feature codes are what test/codes-drift.test.ts finds here.
 *
 * The `next.*` codes are LISTED, not glossed: `loam explain next.adopt` (and
 * every sibling) answers what a step means and what to run, out of the binary
 * rather than out of this file. See ../command-map.ts's header for why the
 * gloss left. What survives here is what `explain` cannot say — that the list
 * splits fleet-wide from per-feature, and that `next.recover-commit` outranks
 * everything in both forms.
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
  first, each carrying a code and the literal command to run — so a step needs no
  gloss here, and \`loam explain <code>\` has the long form of any of them.
  \`next.recover-commit\` outranks every other step in both forms below and is
  never elided: a \`.loam-commit\` journal says a writer was killed mid-commit, so
  some of the files everything else is derived from may be half-written.
  Fleet-wide the rest are \`next.adopt-bound\`, \`next.adopt\`,
  \`next.complete-service\`, \`next.feature\`, \`next.archive\`, \`next.fleet-clean\`,
  \`next.elided\` (the fleet list hit its cap and says how many steps of the same
  kinds it left out — it is ordered most-unblocking first, so work down it and
  re-run) and \`next.fleet-gate\`, always last while anything is outstanding:
  \`loam validate --all\` is what CI runs, and the fleet form grades nothing
  itself. A docs repo with no services and no features instead gets the
  first-hour ladder — \`next.author-landscape\`, \`next.bind-service\`,
  \`next.adopt-first\` — which the \`/loam-adopt\` body walks.
  On one feature: \`next.author-intent\`, \`next.touch-service\`,
  \`next.author-spec\`, \`next.author-openapi\`, \`next.author-scenarios\`,
  \`next.rebase\`, \`next.archive-first\`, \`next.fix-coherence\`,
  \`next.generate-tests\`, \`next.verify\`, \`next.verify-unconfirmed\`,
  \`next.attest-service\` (this repo IS one of the services that owes an answer,
  so the step is bound to this commit), \`next.verify-attested\` — see
  "The done-check" for what attested costs — \`next.archive\`, and
  \`next.archived\` for one that shipped.
  It grades nothing of its own: the verdict is the one \`loam validate --feature\`
  and \`loam archive\` compute — status takes the UNION of what both of them refuse,
  so it may be more pessimistic than either and can never be greener than both.
  \`verification\` carries \`verdict\` (\`verified\` | \`attested\` | \`unverified\`)
  and \`attested\` (how many scenario claims rest on an agent's word) beside the
  recounted totals, and \`checks.issues[]\` carries \`gates\` and \`details\` on every
  finding.
`;
