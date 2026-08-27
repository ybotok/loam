/**
 * The `loam diff` entry of the command map — the PR-review lens of this
 * package, split out for `./context.ts`'s exact reason: command-map.ts sits
 * against the 300-line limit, so the branch-diff surface's documentation
 * lives down here and is concatenated after the map. It is also the
 * documentation home of the whole `diff.*` code vocabulary, which
 * codes-drift requires.
 *
 * Same assembly contract as every section: ../../../agents-md.ts concatenates
 * with NO join separator, so this string starts at the first character of its
 * opening line and ends with the newline that closes its last one.
 */
export const DIFF_COMMAND = `- \`loam diff --base <ref>\` reports the fleet-meaningful changes between the
  living docs and a base git ref of the DOCS repo (a branch, \`origin/main\`, a
  commit sha) — the review lens for a docs-repo PR. Read-only: the base state
  is read with read-only git questions (\`rev-parse\`/\`ls-tree\`/\`show\`), no
  checkout, nothing written. \`validate --all\` stays the fleet gate; diff says
  what a branch CHANGES, and names who currently depends on every removal.
  Codes, per service: \`diff.service-added\` (ok) a \`services/<id>/\` directory
  exists now that did not at base; \`diff.service-removed\` (warn) a base
  service is gone; \`diff.requirement-added\` (ok), \`diff.requirement-removed\`
  (warn) and \`diff.requirement-modified\` (ok — same \`Requirement-ID:\`/heading
  identity, content digest moved; rebase pins never count) over spec.md's
  living requirements; \`diff.op-added\` (ok), \`diff.op-removed\` (warn — no
  current consumer names it), \`diff.op-removed-consumed\` (error — a current
  landscape edge or another service's living requirement still names it;
  details[] lists those victims) and \`diff.op-deprecated\` (warn —
  \`deprecated: true\` introduced since base, current consumers in details[])
  over the OpenAPI contract; \`diff.message-added\` (ok),
  \`diff.message-removed\` (warn) and \`diff.message-removed-consumed\` (error —
  a \`Consumes:\` line or a consumes-edge still names it) over the AsyncAPI
  contract; \`diff.consumer-added\` and \`diff.consumer-removed\` (both ok) when
  a cross-service join — another service's requirement naming this service's
  operation or message — appeared or went away since base. Exit 0 = diff
  computed, nothing breaking, everything readable; exit 1 = a refusal, any
  error finding (\`breaking: true\` in \`--json\`), or a subject whose artifact
  could not be read on either side — those axes are SUSPENDED and reported
  (\`unreadable\` in the payload and the summary), never graded as "nothing
  changed" or "everything added". Refusals reuse existing codes:
  \`repository-unavailable\` when the docs repo has no git history to ask, and
  \`unknown-target\` when \`--base\` resolves to no commit there. For the
  byte-level OpenAPI breaking-change catalogue, run oasdiff on the two states
  of one contract instead — loam deliberately does not reimplement it.
`;
