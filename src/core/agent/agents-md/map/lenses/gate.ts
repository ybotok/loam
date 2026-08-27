/**
 * The `loam gate` entry of the command map — the deploy-pipeline lens of this
 * package, split out for `./context.ts`'s exact reason: command-map.ts sits
 * against the 300-line limit, so the deploy gate's documentation lives down
 * here and is concatenated after the map. Its four `gate.*` codes are what
 * test/codes-drift.test.ts finds here.
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
  \`unknown-service\` — recorded evidence cannot answer for it. Four checks.
  \`partners\` derives the direct joins from the LIVING landscape:
  \`gate.service-undocumented\` (error — the gated service itself sits below
  \`documented\` on the adoption ladder, so the docs cannot say what its joins
  even are; \`loam adopt\` briefs the fix, and the check passes once the
  required artifact set exists; under a map that cannot be read it fires only
  when the service is below \`documented\` regardless of whether an API is
  owed — the api question is then unanswerable, and one unanswerable fact
  yields one finding), \`gate.partner-undocumented\` (warn — a
  direct join partner below \`documented\` or with no services/ directory at
  all, named per partner with the joining operations and messages; a partner
  tagged \`#external\` is exempt on purpose — its docs are somebody else's —
  but an ADOPTED service is never exempt, whatever zone the map draws it
  inside), and \`gate.partners-unknown\` (the landscape could not answer:
  warn when the map is ABSENT — a repo before its first adopt legitimately
  has none — and ERROR when it exists but cannot be parsed or read, the
  reason in the message, because \`loam validate --all\` fails that repo for
  the same file; either way "could not look" never reads as "no partners").
  \`freshness\` re-reports the two staleness findings over the gated service
  and its documented partners — \`content.stale\` and \`sources.stale\` (both
  warn: the doc or the code moved under its vouch) — plus the one integrity
  error that makes freshness unjudgeable, \`frontmatter.malformed\` (a header
  that does not parse cannot certify a digest), and it decodes the spec bytes
  itself, so a UTF-16 spec.md is a \`service.unreadable\` error naming the
  file, never a quiet pass. The rest of provenance stays \`validate\`'s
  report to make.
  \`verification\` covers every ACTIVE feature carrying a specs/ delta for the
  service, through the verification record's own verdicts:
  \`gate.feature-unverified\` (warn — no record, an unreadable or stale one,
  or open claims; the message names the state and the exact
  \`loam verify <FEAT> --json\` to run) and the reused
  \`verify.scenario-attested\` (warn — every claim confirmed, but a scenario
  rests on an agent's word rather than a run). \`interrupted\` reuses
  \`docs.commit-interrupted\` (error): a \`.loam-commit\` journal means the
  docs may be half-written, so nothing graded from them describes one state.
  One unreadable sibling artifact degrades that ONE subject as
  \`service.unreadable\` / \`feature.unreadable\` (error, path recorded when
  Node names one) instead of killing the report. Exit semantics are
  validate's: any error fails (exit 1, \`verdict: "fail"\`), warnings are
  advisory (exit 0, \`verdict: "pass"\`), and \`--strict\` is the CI lever
  that fails warnings too — the report and the \`--json\` payload do not
  change under it. The payload carries \`landscape\`
  (\`read\`/\`absent\`/\`invalid\`), \`partners[]\` (each with its maturity
  rung, role and joins), \`features[]\` (the per-record tallies) and
  \`checks[]\` (the findings, by check), so a pipeline that wants a stricter
  bar — \`vouched\` partners, no attested scenarios — branches on the data
  rather than waiting for a flag.
`;
