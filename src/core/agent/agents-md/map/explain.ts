/**
 * The `loam explain` entry of the command map — its own section module for
 * `./lenses/gate.ts`'s exact reason: command-map.ts sits against the 300-line
 * limit, so the vocabulary command's documentation lives one package down and
 * is concatenated after the map. It introduces no codes of its own: every
 * subject it answers for is a code or term that already exists elsewhere,
 * which is the point of the command.
 *
 * Same assembly contract as every section: ../../agents-md.ts concatenates
 * with NO join separator, so this string starts at the first character of its
 * opening line and ends with the newline that closes its last one.
 *
 * The six term names below are HAND-LISTED, unlike the interpolated copies in
 * commands/explain and core/mcp/tools — importing core/explain/terms.ts from
 * here would close a package cycle, because terms.ts reads its pin sources
 * from this very package's siblings (agents-md → map → explain → agents-md).
 * test/explain.test.ts pins this string against TERMS instead: a term added
 * to the registry without a name here fails there, loudly.
 */
export const EXPLAIN_COMMAND = `- \`loam explain [<subject>]\` answers "what does this mean and what do I do
  about it" from the binary itself: a finding code (\`spine.op-undefined\`), a
  refusal code (\`docs-busy\`), or a concept term — vouch, attested, spine,
  delta, axis, baseline — and \`loam explain\` alone lists the terms. For
  finding codes the meaning-and-fix text IS the /loam-check fix table, parsed
  at runtime from the same body \`loam instructions loam-check\` prints, so the
  two can never disagree; a code graded in more than one table (service scope
  and \`loam archive\` plan time, say) explains every context it appears in,
  and refusal meanings cover every \`error.code\` the envelope can carry. It
  reads no \`loam.json\` and no docs repo, exactly like \`loam instructions\`
  and for the same reason: the vocabulary wall is hit before the wiring
  exists. An unknown subject refuses \`unknown-target\` and offers the closest
  known names.
`;
