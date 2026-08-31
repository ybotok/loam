/**
 * The `loam gate` entry of the command map — the deploy-pipeline lens of this
 * package, split out for `./context.ts`'s exact reason: command-map.ts sat
 * against the file-line limit, so the deploy gate's documentation lives down
 * here and is concatenated after the map. Its four `gate.*` codes are what
 * test/codes-drift.test.ts finds here.
 *
 * The codes are grouped by CHECK and not glossed: which check raises what is
 * the payload's own `checks[]` shape and is the unique thing this section
 * says, while `loam explain gate.partners-unknown` (and every sibling) carries
 * the meaning, the conditional severity and the fix. See ../../command-map.ts's
 * header for why the gloss left.
 *
 * Same assembly contract as every section: ../../../agents-md.ts concatenates
 * with NO join separator, so this string starts at the first character of its
 * opening line and ends with the newline that closes its last one.
 */
export const GATE_COMMAND = `- \`loam gate [--service <id>]\` is the DEPLOY-pipeline question — can this
  service deploy, as far as recorded evidence can say — asked as a pure query:
  it executes nothing, writes nothing, takes no lock, and deliberately changes
  nothing about what gates \`loam archive\` (verify still never gates the
  merge; gate's verdict is advice to a pipeline loam does not own). In a bound
  service repo the invocation is literally \`loam gate --json\`; \`--service\`
  names any other adopted service, and one nobody adopted refuses
  \`unknown-service\` — recorded evidence cannot answer for it. Four checks, and
  the code tells you which one spoke. \`partners\` derives the direct joins from
  the LIVING landscape: \`gate.service-undocumented\`,
  \`gate.partner-undocumented\` and \`gate.partners-unknown\` — the last one
  severity-splits on why the map could not answer, so read
  \`loam explain gate.partners-unknown\` before treating it as advisory. A
  partner tagged \`#external\` is exempt from the middle one on purpose — its
  docs are somebody else's — but an ADOPTED service is never exempt, whatever
  zone the map draws it inside.
  \`freshness\` re-reports two staleness findings \`validate\` already owns,
  \`content.stale\` and \`sources.stale\`, over the gated service and its
  documented partners, plus the one integrity error that makes freshness
  unjudgeable, \`frontmatter.malformed\`; it decodes the spec bytes itself, so a
  UTF-16 spec.md is a \`service.unreadable\` error naming the file, never a quiet
  pass. The rest of provenance stays \`validate\`'s report to make.
  \`verification\` covers every ACTIVE feature carrying a specs/ delta for the
  service, through the verification record's own verdicts:
  \`gate.feature-unverified\` and the reused \`verify.scenario-attested\`.
  \`interrupted\` reuses \`docs.commit-interrupted\`: a \`.loam-commit\` journal
  means the docs may be half-written, so nothing graded from them describes one
  state. One unreadable sibling artifact degrades that ONE subject as
  \`service.unreadable\` / \`feature.unreadable\` instead of killing the report.
  Exit semantics are validate's: any error fails (exit 1, \`verdict: "fail"\`),
  warnings are advisory (exit 0, \`verdict: "pass"\`), and \`--strict\` is the CI
  lever that fails warnings too — the report and the \`--json\` payload do not
  change under it. The payload carries \`landscape\`
  (\`read\`/\`absent\`/\`invalid\`), \`partners[]\` (each with its maturity
  rung, role and joins), \`features[]\` (the per-record tallies) and
  \`checks[]\` (the findings, by check), so a pipeline that wants a stricter
  bar — \`vouched\` partners, no attested scenarios — branches on the data
  rather than waiting for a flag.
`;
