# Vendored contract-results fixture

One byte-stable sample of loam's generic contract-results shape — the format
`loam verify --contract-results` reads, documented normatively in SCHEMA.md's
"Contract-test reports answer the `api.exposes` claims" section. The parser in
`src/core/verify/evidence/contract.ts` is pinned against this exact file by
`test/verify-contract-results.test.ts`, and `test/fixture-integrity.test.ts`
recomputes the checksum below on every run, so neither the sample nor the
documented shape can drift silently: the shape v1 supports IS this file.

## Provenance

`report.json` is **hand-authored to the format's own public schema** — the
shape is loam's, defined in SCHEMA.md, so there is no upstream tool to fetch a
verbatim artifact from; this is the normative sample, not a captured one. It
is written as the output a one-line transform over a real contract tool's
report would produce (the `tool` key on the third entry is the kind of extra
key such a transform leaves behind, present here to pin that extra keys pass
untouched). The entries name the harness fleet's operations
(`test/helpers/harness.ts`): `createSplit` is the operation `coherentFixture()`'s
feature adds, and the two payment-service entries — one passed, one failed —
exercise the rule that entries naming operations outside a feature's checklist
are skipped silently, failures included.

Do not edit these files. To change the documented shape, change SCHEMA.md, the
parser and this fixture together, and re-record the checksum — the shape is
public the moment it ships, so a change here is a compatibility decision, not
an edit.

## Checksums

`shasum -a 256` over the file as committed:

    2a6040154bbe3e5184ba20522ad98b957a8395fc53156e610521976443355959  report.json
