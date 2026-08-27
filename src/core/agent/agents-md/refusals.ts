/**
 * What loam REFUSES: the OpenSpec migration surface, the containment and
 * unreadable-file findings, and the error-envelope codes. What happens to a
 * SHIPPED change — the archive gate, unarchive, and dropping a feature — is
 * the continuation section in ./shipped/archive-gate.ts, split there because
 * the two subjects had grown past one file's ceiling.
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
  \`service-mismatch\`, \`unknown-service\`, or \`repository-unavailable\` when the
  selected service, fleet identity, and repository commit cannot be bound safely,
  and under \`record-federated\` when the legacy all-at-once form would erase other
  repositories' attestations.
- A file loam cannot read is reported, never skipped: \`service.unreadable\` and
  \`feature.unreadable\` (both errors) name the path and say that nothing about
  that target was checked while the rest of the fleet still was. The whole docs
  repo being unreachable is a refusal instead: \`docs-missing\` (\`docsDir\` points
  at nothing) or \`services-missing\` (it is a directory with no \`services/\` —
  usually the service repo after a typo in \`docsDir\`).
- Both modes read frontmatter (\`frontmatter.missing\`, \`frontmatter.malformed\`,
  \`frontmatter.field-mismatch\`,
  \`frontmatter.status-unknown\`, \`frontmatter.field-missing\`); a service's spec.md —
  and its arch.spec.md, same conventions — additionally carries the sources chain
  (\`sources.absent\`, \`sources.path-missing\`, \`sources.empty\`, \`sources.skipped\`,
  \`sources.unvouched\`, \`sources.stale\`) plus the two doc-side checks — \`content.stale\`
  and \`sources.sampled-vouch\` (a person vouched after reading a recorded SAMPLE of the
  document) — which need no service repo, so they fire from the docs repo too.
- A service target run from the service's own repository also re-checks the
  \`evidence_pins\` its federated verification records carry, against the working
  tree: ok \`evidence.checked\` (every pin resolved clean) and \`evidence.unpinned\`
  (a record from before pins existed), warn \`evidence.unresolved\` (the cited
  file is gone, unsafe, not a regular file, or the cited line is past its end),
  \`evidence.moved\` (the file changed, the cited line survives),
  \`evidence.line-changed\` (the cited line no longer says what was recorded),
  \`evidence.token-missing\` (the file contained the literal the claim asserts at
  the attested commit and no longer does) and \`evidence.record-unreadable\` (a
  verification.yaml that exists but cannot be read — none of its evidence was
  checked, and silence there would read as clean). Demote-only, by doctrine: a
  warn here is a reading priority for a reviewer, never a verdict change — no
  pin state moves \`attested\` or \`verified\` in either direction. From the docs
  repo the family is silent; \`sources.unverifiable-from-here\` already names
  that blind spot.
- \`loam archive\` alone reports the breaches only the merge computation can see:
  \`living.requirement-outside-requirements\` (error), \`openapi.op-modified\` (warn),
  \`openapi.path-item-modified\` (warn), \`openapi.component-modified\` (warn),
  \`openapi.ref-unresolved\` (error), \`openapi.remove-marker-path-level\` (error —
  an \`x-loam-remove: true\` written at PATH level, beside the methods rather than
  inside one: it addresses no operation, so it retires nothing, and it is not a
  contract key either), the event axis's own trio \`asyncapi.message-modified\` /
  \`asyncapi.channel-modified\` / \`asyncapi.operation-modified\` (warn — the delta
  redefines a slot the living AsyncAPI already has, and the merge overwrites it
  wholesale), \`asyncapi.ref-unresolved\` (a validate warn, but an error here when
  the MERGED document would carry the dangling reference),
  \`asyncapi.remove-marker-inline\` (error — an \`x-loam-remove: true\` nested on an
  INLINE channel message: inline messages are channel interior, never slots, so
  the marker retires nothing; retire the whole channel, or declare the message
  under \`components.messages\` and mark that)
  and \`service.no-model\` (warn — the archive creates
  \`services/<id>/\`, or puts a service in the landscape the fleet has no directory
  for at all, and nothing writes its model.likec4).

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
\`error.code\`: \`no-config\` / \`config-invalid\` (no loam.json / a corrupt one),
\`docs-missing\` / \`services-missing\` (a \`docsDir\` that points at nothing, or at a
directory that is not a docs repo — the fleet is unreadable, not empty),
\`unknown-target\` (no such service or feature), \`invalid-option\` (flags that contradict
each other, or a value that cannot be right — a \`loam list\` section that is not
services or features, or a service id that is not a legal
\`services/<id>/\` directory name, included), \`already-exists\` (\`loam new\` refusing
to scaffold over an existing feature — also the answer when a concurrent \`new\`
for the same id wins the race; the scaffold commits under the docs lock through
the same journaled transaction as every other writer, so \`new\` can answer
\`docs-busy\`, \`commit-interrupted\`, \`merge-failed\` and — the one that needs
a human — \`rollback-incomplete\` too),
\`sources-absent\` / \`sources-path-missing\` /
\`vouch-raced\` (\`loam vouch\` refusing to stamp — the last one when the document
changed between the read and the write, so nothing was written; vouch now takes
the docs lock for its commit window and journals it, so it can also answer
\`docs-busy\`, \`commit-interrupted\`, \`merge-failed\` and \`rollback-incomplete\`),
\`not-coherent\` / \`living-outside-requirements\` /
\`archive-exists\` / \`merge-failed\` / \`rollback-incomplete\` / \`docs-busy\` /
\`commit-interrupted\`
(\`loam archive\` — see the
archive gate below; \`docs-busy\` means another writer — an archive, unarchive,
rebase, vouch, \`new\`, or a \`verify --record\` — holds the docs repo's lock,
nothing was read or written, and re-running once it finishes works),
\`feature-active\` / \`snapshot-missing\` / \`snapshot-stale\` / \`snapshot-corrupt\` /
\`restore-failed\` / \`rollback-incomplete\` / \`docs-busy\` / \`commit-interrupted\`
(\`loam unarchive\` — the
\`restore-failed\` / \`rollback-incomplete\` pair splits
exactly as archive's does; see "Taking an archive back"). \`commit-interrupted\` is
the pair's shared refusal: a previous archive or unarchive was killed mid-commit
and this run cannot repair it on its own — a half-written file has been edited
since, the repairing pre-image is gone or altered, or \`.loam-commit\` itself
cannot be read. \`loam doctor\` names the same state as
\`doctor.commit-interrupted\`, \`loam validate\` leads every mode with
\`docs.commit-interrupted\` while the journal sits there, and every journaled
writer — archive, unarchive, rebase, vouch, \`new\`, \`gherkin\`,
\`verify --record\` — recovers a finished predecessor's journal on its next run
and reports it as \`recovered\` in \`--json\`. And \`gherkin-conflict\`
(\`loam gherkin <FEAT>\` would overwrite a \`.feature\` file owned by another
feature still in flight — the whole emission refuses and names the owner;
\`gherkin\` commits into the service repo's own \`<gherkinDir>/loam/\` through the
same lock and journal, so it can answer \`docs-busy\`, \`commit-interrupted\`,
\`merge-failed\` and \`rollback-incomplete\` about that root),
\`subsystem-not-empty\` / \`move-uncommitted\` / \`move-failed\` / \`merge-failed\` /
\`unknown-target\` / \`already-exists\` / \`invalid-option\` / \`docs-busy\` /
\`commit-interrupted\` / \`rollback-incomplete\` (\`loam subsystem\` — \`rm\`
refuses a group that still holds members, naming them; \`move\`/\`rename\` refuse
ONLY when git reports uncommitted or untracked paths under a directory being
moved — commit them, \`git stash -u\` (plain \`stash\` leaves untracked files
behind), or remove them, then re-run; where git cannot say at all the move
proceeds, because that refusal needs positive evidence; \`move-failed\` means
the move's transaction rolled back cleanly — renames undone, the generated
views file restored, nothing changed, re-running can work — kept distinct
from \`merge-failed\`, which \`new\`/\`rm\`/\`sync\` answer when their one-file
commit fails and is rolled back (no merge was computed there either; the word
is the shared transaction's), while \`rollback-incomplete\` keeps archive's
meaning: some of it could not be taken back, and the message lists what to
check by hand. Names that resolve to nothing, collide in the flat namespace,
or break the grammar reuse \`unknown-target\`, \`already-exists\` and
\`invalid-option\`),
\`answers-unreadable\` / \`answers-mismatch\` /
\`answers-unevidenced\` / \`record-federated\` / \`record-unreadable\` /
\`record-raced\` / \`docs-busy\`
(\`loam verify --record\` / \`--results\` / \`--contract-results\` — an unreadable
or unrecognizable cucumber or contract-test report refuses under
\`answers-unreadable\` too;
\`record-federated\` and \`record-unreadable\` are the two records loam will not
overwrite. Recording holds the docs repo's lock and commits the record
atomically over the exact bytes it read: \`record-raced\` means the file changed
underneath anyway — an editor, or a writer that skipped the lock — and nothing
was written, so re-running merges over the record as it now stands; \`docs-busy\`
means another writer held the lock for longer than the record was willing to
wait. Two records for different services land in either order — the later one
waits, then merges, and both attestations survive. The shared commit path can
also answer \`merge-failed\` (the swap itself failed — nothing was recorded,
re-running can work) and \`rollback-incomplete\` (cleanup failed too; the named
file needs a human), with exactly the meanings archive gives them),
\`no-members\` / \`binding-duplicate\` / \`invalid-option\` / \`already-exists\`
(\`loam open\`, deriving an editor workspace from the committed bindings — no
service checkout bound to this docs repo was found under any scanned root, so
the workspace would hold only the docs repo, fixable by cloning a bound
checkout beside it or passing \`--root\`; two discovered checkouts declare the
same \`service\` and loam will not guess which one speaks for it — narrow the
scan with \`--root\` or fix the stray binding; a \`--root\` or \`--out\` that names
nothing readable, or a \`--root\` the scan cannot list, is \`invalid-option\`;
and the workspace file itself, which loam never silently overwrites — pass
\`--out\` or \`--force\`),
\`seed-file-invalid\` / \`seed-duplicate-service\` / \`seed-unknown-subsystem\` /
\`seed-landscape-edited\` / \`unknown-service\`
(\`loam seed --from fleet.yaml\`, templating architecture/landscape.likec4 and one
services/<id>/ directory per service out of a tiny human-authored file — the
human states the facts, loam guesses nothing. \`seed-file-invalid\` is anything
wrong with the file itself — missing, not YAML, the wrong shape, an illegal id;
the message names file and line — and the preflight: fleet.yaml must name every
existing services/<id>/ (the refusal carries the ids as \`missingServices\`).
\`seed-duplicate-service\`: one name declared twice — service ids, subsystem
names and externals share one flat namespace, both lines named.
\`seed-unknown-subsystem\`: a \`subsystem:\` naming nothing \`subsystems:\`
declares, with a did-you-mean hint; a call endpoint nothing declares reuses
\`unknown-service\` — correct the name, re-run. And
\`seed-landscape-edited\` is the never-overwrite posture: the landscape carries
hand edits (the line-1 \`loam-seed sha256:\` digest no longer matches) or was
authored some other way — seed refuses and writes nothing; fold the edits into
fleet.yaml and delete the file, or keep the map and stop using seed. Seed
shares every journaled writer's lock, transaction and recovery codes; an
existing service directory is never moved, and nothing is ever deleted), and
\`internal\` — an unexpected throw, the one code with no stable meaning.

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
