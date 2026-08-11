/**
 * What loam REFUSES, and how a shipped change is gated, undone or dropped:
 * the OpenSpec migration surface, the containment and unreadable-file
 * findings, the error-envelope codes, the archive gate, unarchive, and
 * dropping a feature.
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
  (\`sources.absent\`, \`sources.path-missing\`, \`sources.empty\`,
  \`sources.skipped\`, \`sources.unvouched\`, \`sources.stale\`) and the doc-side freshness check
  (\`content.stale\`) — the one provenance warning that needs no service repo, so
  it is reported from the docs repo too, \`--service\` and \`--all\` alike.
- \`loam archive\` alone reports the breaches only the merge computation can see:
  \`living.requirement-outside-requirements\` (error), \`openapi.op-modified\` (warn),
  \`openapi.path-item-modified\` (warn), \`openapi.component-modified\` (warn),
  \`openapi.ref-unresolved\` (error), \`openapi.remove-marker-path-level\` (error —
  an \`x-loam-remove: true\` written at PATH level, beside the methods rather than
  inside one: it addresses no operation, so it retires nothing, and it is not a
  contract key either) and \`service.no-model\` (warn — the archive creates
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
something missing — the adoption worklist.

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
to scaffold over an existing feature), \`sources-absent\` / \`sources-path-missing\` /
\`vouch-raced\` (\`loam vouch\` refusing to stamp — the last one when the document
changed between the read and the write, so nothing was written),
\`not-coherent\` / \`living-outside-requirements\` /
\`archive-exists\` / \`merge-failed\` / \`rollback-incomplete\` / \`docs-busy\` /
\`commit-interrupted\`
(\`loam archive\` — see the
archive gate below; \`docs-busy\` means another archive or unarchive holds the docs
repo's lock, nothing was read or written, and re-running once it finishes works),
\`feature-active\` / \`snapshot-missing\` / \`snapshot-stale\` / \`snapshot-corrupt\` /
\`restore-failed\` / \`rollback-incomplete\` / \`docs-busy\` / \`commit-interrupted\`
(\`loam unarchive\` — the
\`restore-failed\` / \`rollback-incomplete\` pair splits
exactly as archive's does; see "Taking an archive back"). \`commit-interrupted\` is
the pair's shared refusal: a previous archive or unarchive was killed mid-commit
and this run cannot repair it on its own — a half-written file has been edited
since, the repairing pre-image is gone or altered, or \`.loam-commit\` itself
cannot be read. \`loam doctor\` names the same state as
\`doctor.commit-interrupted\`. And \`gherkin-conflict\`
(\`loam gherkin <FEAT>\` would overwrite a \`.feature\` file owned by another
feature still in flight — the whole emission refuses and names the owner),
\`answers-unreadable\` / \`answers-mismatch\` /
\`answers-unevidenced\` / \`record-federated\` / \`record-unreadable\`
(\`loam verify --record\` / \`--results\` — an unreadable or
unrecognizable cucumber report refuses under \`answers-unreadable\` too;
\`record-federated\` and \`record-unreadable\` are the two records loam will not
overwrite), and
\`internal\` — an unexpected throw, the one code with no stable meaning.

\`--all\` reports a target per service, a target per feature in flight, and one target
of kind \`landscape\` for the fleet-level checks that belong to no single service.

Three different words for three different questions, and no command conflates them:
\`ok\` — the command ran; \`valid\` — the documents pass (\`validate\`); \`verified\` —
somebody says the code was built and showed evidence (\`verify\`). A feature can be
valid and unverified, or verified and incoherent. Read the one you meant.

## The archive gate

The three axes agreeing is called **coherence**, and \`loam validate --feature\` reports
it as such. \`loam archive\` runs the same coherence check first and refuses a feature
with GATING issues — every error, plus the rare warning marked \`gates: true\` because
the merge would silently drop authored content even though the document is legal.
Advisory warnings never block: archive prints them and proceeds. Each one still names
something real — usually something the merge will drop or overwrite — so read them
before the merge runs, not after.

\`--approve\` overrides the gating issues — only those, and archive prints exactly which
ones it overrode. It is a human decision, not an agent's: if archive refuses, fix the
breach or hand it back.

Breaches only the merge computation itself can see are reported at plan time,
after the gate. \`living.requirement-outside-requirements\` (error): the LIVING spec
holds a requirement outside \`## Requirements\`, and the merge rewrites only that
section, so the requirement would land in the file twice — \`--approve\` does not
override it, because the duplication is mechanical, not a judgment call; re-home the
requirement first. \`openapi.op-modified\` (warn): the feature redefines an operation
the living OpenAPI already has, and the merge overwrites the living definition
wholesale.

The OpenAPI merge also carries the merged operations' \`$ref\` closure: every
\`#/components/<kind>/<name>\` they reference — recursively, a component's own refs
included — is copied from the feature document into the living one, so an operation
never lands pointing at a schema that stayed behind. \`openapi.component-modified\`
(warn): a carried component overwrites a living one that differs, wholesale, same
discipline as an operation. \`openapi.ref-unresolved\` (error, \`--approve\`
overrides): a ref reachable from the merged operations resolves in neither
document, so merging would write a dangling reference. External refs — URLs, file
paths, anything not starting \`#/\` — are out of scope: left untouched, never gated.

## Taking an archive back

\`loam unarchive <FEAT>\` restores the living docs and re-opens the feature. It works
by putting bytes back, not by inverting the merge — archive copies every file it is
about to overwrite into \`features/archive/<FEAT>/.loam-before/\` first, because the
previous text of a \`MODIFIED\` requirement is written down nowhere else. Do not edit
or delete that directory, and never reconstruct an old living spec by hand from an
archived delta: what the requirement said BEFORE is not in there, and a plausible
reconstruction is a lie the next reader has no way to catch.

Every pre-image is digested when the archive writes it, and re-checked before the
restore stages anything: \`snapshot-corrupt\` means a pre-image's bytes no longer
match the digest archive recorded for them, so restoring it would write text
nobody authored. \`--force\` does NOT override that one — the damage is to the
undo itself, not to the living docs — and the fix is version control.

It refuses rather than guesses, under codes you can branch on: \`feature-active\` (a
feature of that id is in flight again), \`snapshot-missing\` (archived before loam
recorded this — the docs have to come back from version control), \`snapshot-stale\`
(a merged file changed after the archive, so restoring would revert someone else's
work). \`--force\` overrides the last one, and like \`--approve\` it is a human's call.

A restore that fails outright splits the same way archive's does: \`restore-failed\`
means nothing was restored or everything was rolled back — the living docs are
unchanged, fix the reported cause and re-run; \`rollback-incomplete\` means the
restore failed AND some files could not be put back — stop and hand it to a human,
the message lists the files to check.

## Dropping a feature

A feature that was never archived is one directory and nothing else: no living doc
references it until \`loam archive\` merges it. To abandon it, delete the directory —
\`git rm -r features/<FEAT-dir>\` — and version control keeps the record of the
attempt. An ARCHIVED feature is the opposite, its content folded into the living
docs: run \`loam unarchive <FEAT>\` first, then delete. There is no \`loam abandon\`,
deliberately — a removal that computes nothing is what version control is for.
`;
