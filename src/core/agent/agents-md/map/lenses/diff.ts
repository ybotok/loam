/**
 * The `loam diff` entry of the command map — the PR-review lens of this
 * package, split out for `./context.ts`'s exact reason: command-map.ts sat
 * against the file-line limit, so the branch-diff surface's documentation
 * lives down here and is concatenated after the map. It is also the
 * documentation home of the whole `diff.*` code vocabulary, which
 * codes-drift requires.
 *
 * The codes are grouped by the ARTIFACT they are computed over and not
 * glossed: that grouping is what nothing else says, while
 * `loam explain diff.op-removed-consumed` (and every sibling) carries the
 * meaning, the severity and the fix. See ../../command-map.ts's header for why
 * the gloss left.
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
  Codes, per service and grouped by the artifact they are computed over:
  \`diff.service-added\` and \`diff.service-removed\` over the \`services/<id>/\`
  directory; \`diff.requirement-added\`, \`diff.requirement-removed\` and
  \`diff.requirement-modified\` over spec.md's living requirements;
  \`diff.op-added\`, \`diff.op-removed\`, \`diff.op-removed-consumed\` and
  \`diff.op-deprecated\` over the OpenAPI contract; \`diff.message-added\`,
  \`diff.message-removed\` and \`diff.message-removed-consumed\` over the AsyncAPI
  contract; and \`diff.consumer-added\` / \`diff.consumer-removed\` over the
  cross-service joins — another service's requirement naming this service's
  operation or message. The two \`-consumed\` codes are the errors: they are the
  removals something in the fleet still names, with the victims in
  \`details[]\`. Exit 0 = diff computed, nothing breaking, everything readable;
  exit 1 = a refusal, any error finding (\`breaking: true\` in \`--json\`), or a
  subject whose artifact could not be read on either side — those axes are
  SUSPENDED and reported (\`unreadable\` in the payload and the summary), never
  graded as "nothing changed" or "everything added". Refusals reuse existing
  codes: \`repository-unavailable\` when the docs repo has no git history to ask,
  and \`unknown-target\` when \`--base\` resolves to no commit there. For the
  byte-level OpenAPI breaking-change catalogue, run oasdiff on the two states
  of one contract instead — loam deliberately does not reimplement it.
`;
