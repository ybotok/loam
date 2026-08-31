/**
 * How a SHIPPED change is gated, undone or dropped: the archive gate,
 * unarchive, and dropping a feature. The continuation of ../refusals.ts —
 * that module holds what loam refuses and the error-envelope codes; this one
 * holds what happens to a feature once the merge is on the table. Split
 * there because the two subjects were one 300-plus-line file, and the file's
 * own header already named them separately.
 *
 * One section of the AGENTS.md template. ../../agents-md.ts assembles the
 * document by PLAIN CONCATENATION — no join separator — so this section
 * starts at the first character of its opening heading and ends with the
 * newline that closes its last line. Keep that shape when editing, or two
 * sections glue onto one line in every docs repo loam scaffolds from now on.
 */
export const ARCHIVE_GATE = `## The archive gate

The three axes agreeing is called **coherence**, and \`loam validate --feature\` reports
it as such. \`loam archive\` runs the same coherence check first and refuses a feature
with GATING issues — every error, plus the rare warning marked \`gates: true\` because
the merge would silently drop authored content even though the document is legal.
Advisory warnings never block: archive prints them and proceeds. Each one still names
something real — usually something the merge will drop or overwrite — so read them
before the merge runs, not after.

\`--approve\` overrides the gating issues — only those, and archive prints exactly which
ones it overrode. It is a human decision, not an agent's: if archive refuses, fix the
breach or hand it back. Two refusals sit outside its reach, because the damage is
mechanical rather than a judgment about the feature: \`delta.service-id-invalid\` — a
\`specs/<svc>/\` directory whose name is not a legal service id, which the merge
would materialise as a \`services/<svc>/\` every loam command then refuses to
address — and \`c4.service-binding-invalid\` — an explicit \`metadata { service }\`
binding that breaks the same grammar, on a tagged element or anything nested
inside its block (the merge splices the whole authored block into the living
landscape verbatim, untagged children included, and a \`../\` in the binding even
collapses the archive's \`services/\` probe out of the docs repo). There is
nothing a judgment call could accept: rename the directory, or fix the binding,
instead.

Breaches only the merge computation itself can see are reported at plan time,
after the gate. \`living.requirement-outside-requirements\` (error): the LIVING spec
holds a requirement outside \`## Requirements\`, and the merge rewrites only that
section, so the requirement would land in the file twice — \`--approve\` does not
override it, because the duplication is mechanical, not a judgment call; re-home the
requirement first. \`openapi.op-modified\` (warn): the feature redefines an operation
the living OpenAPI already has, and the merge overwrites the living definition
wholesale.

The OpenAPI merge also carries a \`$ref\` closure rooted in what it actually WROTE
— the merged operations and the components this delta declares alike: every
\`#/components/<kind>/<name>\` they reference, recursively with a component's own
refs included, is copied from the feature document into the living one, so nothing
lands pointing at a schema that stayed behind. A delta whose whole change is a
shared schema, with no \`paths\` at all, is merged the same way and by the same
rules. \`openapi.component-modified\` (warn): a carried component overwrites a
living one that differs, wholesale, same discipline as an operation.
\`openapi.ref-unresolved\` (error, \`--approve\` overrides): a ref reachable from the
merged operations or a merged component resolves in neither document, so merging
would write a dangling reference. External refs — URLs, file paths, anything not
starting \`#/\` — are out of scope: left untouched, never gated.

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
