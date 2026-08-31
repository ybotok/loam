/**
 * What loam REFUSES: the OpenSpec migration surface, the containment and
 * unreadable-file findings, and the error-envelope codes. What happens to a
 * SHIPPED change — the archive gate, unarchive, and dropping a feature — is
 * the continuation section in ./shipped/archive-gate.ts, split there because
 * the two subjects had grown past one file's ceiling.
 *
 * Codes here are LISTED by the command that raises them, not glossed; the
 * meanings come from `loam explain <code>`, out of the running binary. See
 * ./command-map.ts's header for why the duplicated gloss left.
 *
 * THE ONE EXCEPTION IS THE FIRST BULLET. `loam explain` cannot answer
 * `openspec.*` or `mapping.*` — those commands grade a repository still in
 * another tool's shape, before it has a governed loop to look a code up from,
 * and the catalogue leaves them unanswered for that reason. Pointing this
 * section's reader at an explanation that does not exist is the exact failure
 * the pointer exists to prevent, so the migration notes stay written out here
 * until the catalogue reaches them. test/agent-contract.test.ts enforces the
 * boundary from the other side: every OTHER code backticked in AGENTS_MD must
 * resolve, so a family can never quietly lose its gloss and its explanation
 * at once.
 *
 * One section of the AGENTS.md template. ../agents-md.ts assembles the
 * document by PLAIN CONCATENATION — no join separator — so every section
 * starts at the first character of its opening line and ends with the newline
 * that closes its last one. Keep that shape when editing, or two sections glue
 * onto one line in every docs repo loam scaffolds from now on.
 */
export const REFUSALS = `- \`loam audit-openspec <root>\` is the read-only OpenSpec inventory; an explicit
  \`--write-mapping\` writes a non-overwriting, digest-bound decision skeleton
  outside the source tree. \`loam migrate-openspec <root> --map <file>\` validates
  that mapping and stays dry-run unless both \`--apply\` and an empty \`--target\`
  are supplied. Living/active shape diagnostics are \`openspec.workspace-empty\`
  (the audited root holds no living spec and no active change, so there is
  nothing to migrate and no verdict over it can be \`ready\`),
  \`openspec.specs-missing\`,
  \`openspec.config-invalid\`, \`openspec.external-store-pointer\`,
  \`openspec.living-empty\`, \`openspec.living-requirements-outside-section\`,
  \`openspec.living-delta-section\`, \`openspec.nonstandard-living-spec\` (markdown
  under \`specs/\` named neither spec.md nor design.md, so no capability reads
  it), \`openspec.change-metadata-invalid\`,
  \`openspec.change-schema-unresolved\`, \`openspec.skip-specs-with-specs\`,
  \`openspec.change-no-specs\`, \`openspec.change-empty\`,
  \`openspec.change-without-delta-sections\`,
  \`openspec.change-requirements-outside-delta-sections\`,
  \`openspec.change-quoted-requirements\` (requirements under a \`## Requirements\`
  heading INSIDE a change delta — the shape OpenSpec's own living-spec template
  mandates, and one that stages nothing, so loam refuses it rather than counting
  requirements it cannot route),
  \`openspec.hidden-change-directory\` (a dot-prefixed directory under
  \`changes/\` is not enumerated as a change, so nothing under it migrates —
  rename it or move it out; under \`changes/archive/\` the same code is an archive
  diagnostic and does not gate, because frozen history never blocks),
  \`openspec.nonstandard-change-spec\`, \`openspec.renamed-malformed\`,
  \`openspec.requirement-id-invalid\`, \`openspec.requirement-id-repeated\`,
  \`openspec.requirement-id-duplicate\` (a stable \`Requirement-ID\` that is
  malformed, declared twice, or shared by two requirements — identity is never
  inferred from an invalid declaration, so the RENAMED chain cannot be followed
  through it), \`openspec.symlink-unsupported\`, and \`openspec.non-utf8-artifact\`;
  the same shapes in frozen history are non-blocking archive diagnostics.
  Mapping refuses stale or incomplete decisions under \`mapping.source-missing\`,
  \`mapping.source-root-mismatch\`, \`mapping.source-digest-mismatch\`,
  \`mapping.unknown-capability\`, \`mapping.unknown-requirement\`,
  \`mapping.requirement-allocation-missing\`,
  \`mapping.requirement-service-unknown\`, \`mapping.service-allocation-empty\`,
  \`mapping.unknown-change\`, \`mapping.change-title-missing\`,
  \`mapping.feature-id-invalid\`, \`mapping.feature-id-duplicate\`,
  \`mapping.unknown-rename\`, \`mapping.invalid-requirement-id\`,
  \`mapping.rename-source-missing\`, \`mapping.rename-source-ambiguous\`,
  \`mapping.rename-source-id-invalid\`, \`mapping.rename-target-conflict\`,
  \`mapping.rename-existing-id-conflict\`, \`mapping.rename-id-conflict\`,
  \`mapping.rename-double-source\`, \`mapping.rename-double-target\`,
  \`mapping.rename-chain\`,
  \`mapping.unknown-artifact\`, and \`mapping.invalid-artifact-disposition\`.
- Repository containment failures are explicit: \`sources.path-outside\` rejects a
  provenance source outside the service repo and \`gherkin.path-outside\` rejects a
  generated-suite target outside it. Federated verify recording refuses under
  \`service-mismatch\`, \`unknown-service\` or \`repository-unavailable\` when the
  selected service, fleet identity and repository commit cannot be bound safely,
  and under \`record-federated\` when the legacy all-at-once form would erase other
  repositories' attestations. \`loam gherkin --service <id>\` and
  \`loam vouch --service <id>\` answer that same wrong-repo pair
  (\`repository-unavailable\`, \`service-mismatch\`) for the same reason. Neither is
  \`invalid-option\`: the flags were right and the directory was wrong, so the fix
  is to re-run in the service's own checkout, never to re-read the invocation.
- A file loam cannot read is reported, never skipped: \`service.unreadable\` and
  \`feature.unreadable\` (both errors) name the path and say that nothing about
  that target was checked while the rest of the fleet still was. The whole docs
  repo being unreachable is a refusal instead: \`docs-missing\` or
  \`services-missing\`.
- Both modes read frontmatter (\`frontmatter.missing\`, \`frontmatter.malformed\`,
  \`frontmatter.field-mismatch\`,
  \`frontmatter.status-unknown\`, \`frontmatter.field-missing\`); a service's spec.md —
  and its arch.spec.md, same conventions — additionally carries the sources chain
  (\`sources.absent\`, \`sources.path-missing\`, \`sources.empty\`, \`sources.skipped\`,
  \`sources.unvouched\`, \`sources.stale\`) plus the two doc-side checks,
  \`content.stale\` and \`sources.sampled-vouch\`, which need no service repo and so
  fire from the docs repo too.
- A service target run from the service's own repository also re-checks the
  \`evidence_pins\` its federated verification records carry, against the working
  tree: \`evidence.checked\` and \`evidence.unpinned\` are the confirmations,
  \`evidence.unresolved\`, \`evidence.moved\`, \`evidence.line-changed\`,
  \`evidence.token-missing\` and \`evidence.record-unreadable\` the warnings.
  Demote-only, by doctrine: a warn here is a reading priority for a reviewer,
  never a verdict change — no pin state moves \`attested\` or \`verified\` in
  either direction. From the docs repo the family is silent;
  \`sources.unverifiable-from-here\` already names that blind spot.
- \`loam archive\` alone reports the breaches only the merge computation can see:
  \`living.requirement-outside-requirements\`, \`openapi.op-modified\`,
  \`openapi.path-item-modified\`, \`openapi.component-modified\`,
  \`openapi.ref-unresolved\`, \`openapi.remove-marker-path-level\`, the event
  axis's own trio \`asyncapi.message-modified\` / \`asyncapi.channel-modified\` /
  \`asyncapi.operation-modified\`, \`asyncapi.ref-unresolved\`,
  \`asyncapi.remove-marker-inline\` and \`service.no-model\`. Two of those are
  graded at validate time as well and are STRICTER here —
  \`openapi.ref-unresolved\` and \`asyncapi.ref-unresolved\` are warnings there and
  errors here, because the merged document is what would carry the dangling
  reference — so \`loam explain\` on either prints both contexts.

\`loam validate <target>\` is the positional spelling of the first two: a feature id
or a service id, tried in that order, so the feature wins when one name could be
both and \`--service\`/\`--feature\` force the reading. When the name really is both,
the run says so — \`target.ambiguous\` (warn) names the reading it took and the
flag that forces the other, and \`--json\` carries \`resolvedKind\` — because a
silent precedence rule is a report about a target nobody asked for. The
positional together with \`--all\`, \`--service\` or \`--feature\` is refused
(\`invalid-option\`).

Two rendering levers change nothing else: \`loam validate --errors-only\` drops
the confirmations from the TEXT view (the \`--json\` payload is byte-identical),
and \`loam list --needs-work\` narrows the service list to the ones with
something missing — the adoption worklist. \`loam list --needs-work --review-order\`
orders that worklist by fan-in — the services the most other services depend on
first: drawn call edges into each, plus event subscriptions (a drawn \`consumes\`
edge, or a living \`Consumes:\` line naming a message it sends) — a count, never
a priority judgement — and its \`--json\` rows then additionally carry \`fanIn\`
and \`reviewRank\`; without \`--needs-work\` the flag is refused (\`invalid-option\`).

Two campaign flags slice that same services section and change nothing about
any row. \`loam list --subsystem <name>\` limits the listing to the services
filed under one subsystem, at any depth: \`services[]\`, the \`maturity\` rollup
and \`subsystems[]\` reflect the slice (\`unfiledServices\` is omitted — it is a
fleet-root fact), while every per-row fact — \`fanIn\`, \`apiExpected\`,
\`missing\` — is still computed fleet-wide, so filtering changes which rows
appear, never what a row says; with \`--review-order\` the filter applies first
and \`reviewRank\` stays contiguous within the filtered worklist. The name
\`unfiled\` selects the services filed under no subsystem while nothing in the
tree claims that name (a real subsystem or service spelled \`unfiled\` wins).
An unknown name refuses \`unknown-target\` with close-name hints; a service
name refuses \`invalid-option\`. \`loam list --owners <path>\` joins each listed
service's directory to the owning teams in the named CODEOWNERS file —
directory-pattern rules only, last match wins, an owner-less directory rule
CLEARING ownership for what it matches exactly as the forge reads it; a
recognised rule outside that subset (any other wildcard use, \`*\` included)
is reported under \`skippedRules\`, never guessed at — and \`--json\` gains the additive \`owners\`
key (\`path\`, \`teams[]\` with each team's services in the listing's own
filtered-and-ordered row order, \`unowned[]\` listing the rows no rule matched,
\`skippedRules[]\`), so the per-team arrays are the per-team campaign
worklists. A CODEOWNERS path that cannot be read, or a line that cannot be
parsed as \`pattern owner…\`, refuses \`owners-unreadable\` naming the path and
line — fail-closed, exactly as \`answers-unreadable\` treats the other
user-named file. Either flag with the \`features\` or \`capabilities\` section
is refused (\`invalid-option\`).

\`--strict\` (every targeting mode, \`--all\` included) exits 1 when any error
or warning exists — \`ok\`-severity findings are confirmations and never trip
it. It changes the exit code and nothing else:
\`valid\` still means "no errors", and the \`--json\` payload stays byte-for-byte
what it was. The stricter grade is a per-invocation lever, visible in the CI
pipeline that passes the flag — deliberately not a per-repo profile.

\`loam delta <FEAT> --json\` exits 1 when either authored document behind the brief
failed to parse — \`architecture.errors\` non-empty, or \`openapi.unreadable\` true —
with \`ok: true\` and the full payload intact: the empty C4 slice means the delta
did not parse, and an empty \`api\` beside \`openapi.unreadable\` means the contract
delta did not parse, neither of them "this feature changes nothing there". Branch
on the exit code before consuming either slice as a task brief.

Findings with severity \`ok\` are confirmations, not work: \`c4.valid\`, \`delta.valid\`,
\`requirements.covered\`, \`api.covered\`, \`spine.resolved\`, \`event.covered\`, \`coherence.ok\`,
\`landscape.matched\`, \`archedge.covered\`, \`sources.resolved\`, \`sources.current\`,
\`sources.walked\`, \`gherkin.current\`.

A finding's \`subject\` names the service it is about. The envelope separates \`ok\` (the
command ran) from \`valid\` (the docs pass). A refusal is \`ok: false\` with a stable
\`error.code\`, and \`loam explain <code>\` has the meaning of every one of them. What
follows is the other half — which command raises which:

- Before any command can read anything: \`no-config\`, \`config-invalid\`,
  \`docs-missing\`, \`services-missing\`, \`unknown-target\`, \`invalid-option\`.
  \`invalid-option\` covers flags that contradict each other AND a value that
  cannot be right — a \`loam list\` section that is not services or features, or a
  service id that is not a legal \`services/<id>/\` directory name.
- Every JOURNALED writer — \`archive\`, \`unarchive\`, \`rebase\`, \`vouch\`, \`new\`,
  \`gherkin\`, \`seed\`, \`subsystem\` and \`verify --record\` — shares one transaction
  and therefore one set of refusals: \`docs-busy\`, \`commit-interrupted\`,
  \`merge-failed\` and \`rollback-incomplete\`. Learn them once and you have read
  them for all nine. \`loam doctor\` names the interrupted state as
  \`doctor.commit-interrupted\` and \`loam validate\` leads every mode with
  \`docs.commit-interrupted\` while the journal sits there; every journaled writer
  recovers a finished predecessor's journal on its next run and reports it as
  \`recovered\` in \`--json\`.
- \`loam new\`: \`already-exists\` — also the answer when a concurrent \`new\` for the
  same id wins the race.
- \`loam vouch\`: \`sources-absent\`, \`sources-path-missing\`, \`vouch-raced\`, and the
  wrong-repo pair \`repository-unavailable\` / \`service-mismatch\`, because
  \`sources\` resolve against the service's own checkout and from anywhere else
  those paths are somebody else's.
- \`loam archive\`: \`not-coherent\`, \`living-outside-requirements\`,
  \`archive-exists\` — see the archive gate below.
- \`loam unarchive\`: \`feature-active\`, \`snapshot-missing\`, \`snapshot-stale\`,
  \`snapshot-corrupt\`, \`restore-failed\` — see "Taking an archive back".
- \`loam gherkin\`: \`gherkin-conflict\`, plus the same wrong-repo pair, refused
  before anything is written because the generated files land in the repo loam
  is standing in.
- \`loam subsystem\`: \`subsystem-not-empty\`, \`move-uncommitted\`, \`move-failed\`,
  and \`unknown-target\` / \`already-exists\` / \`invalid-option\` for names that
  resolve to nothing, collide in the flat namespace, or break the grammar.
  \`move-failed\` is deliberately distinct from \`merge-failed\`: the move's own
  transaction rolled back cleanly, nothing changed, and re-running can work.
- \`loam verify --record\` / \`--results\` / \`--contract-results\`:
  \`answers-unreadable\`, \`answers-mismatch\`, \`answers-unevidenced\`,
  \`record-federated\`, \`record-unreadable\` and \`record-raced\`. Two records for
  different services land in either order — the later one waits, then merges,
  and both attestations survive.
- \`loam open\`: \`no-members\`, \`binding-duplicate\`, \`already-exists\` (the
  workspace file, which loam never silently overwrites — pass \`--out\` or
  \`--force\`) and \`invalid-option\`.
- \`loam seed --from fleet.yaml\`: \`seed-file-invalid\`, \`seed-duplicate-service\`,
  \`seed-unknown-subsystem\`, \`seed-landscape-edited\`, and \`unknown-service\` for a
  call endpoint nothing declares. An existing service directory is never moved,
  and nothing is ever deleted.
- \`internal\` — an unexpected throw, the one code with no stable meaning.

\`--all\` reports a target per service, a target per feature in flight, and one target
of kind \`landscape\` for the fleet-level checks that belong to no single service.

Three different words for three different questions, and no command conflates them:
\`ok\` — the command ran; \`valid\` — the documents pass (\`validate\`); \`verified\` —
somebody says the code was built and showed evidence (\`verify\`). A feature can be
valid and unverified, or verified and incoherent. Read the one you meant.
`;

/* The archive gate, unarchive, and dropping a feature continue in
 * ./shipped/archive-gate.ts — one document section split at its own subject
 * seam, concatenated after this one by ../agents-md.ts. */
