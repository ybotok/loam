/**
 * The `loam context` entry of the command map — one of the three consumer
 * LENSES this package holds (the agent briefing here, `./gate.ts`'s deploy
 * pipeline, `./diff.ts`'s PR review), the family carved out of `../` when the
 * map package hit its own five-file cap: command-map.ts sits against the
 * file-line limit, so the pack's documentation lives down here and is
 * concatenated after the map.
 *
 * Same assembly contract as every section: ../../../agents-md.ts concatenates
 * with NO join separator, so this string starts at the first character of its
 * opening line and ends with the newline that closes its last one.
 */
export const CONTEXT_COMMAND = `- \`loam context <service>\` assembles the docs slice bound to one service as a
  single deterministic briefing — the pack an agent loads before working in
  that service's repository. It writes nothing. One payload carries the living
  requirements and arch requirements VERBATIM (bodies and scenarios included),
  the OpenAPI operations with the requirements governing each, the AsyncAPI
  messages with their send/receive direction, the fleet edges one hop out with
  the map's own health beside them (\`landscape.present\` is the FILE,
  \`landscape.parses\` is the whole \`architecture/\` project the renderer loads,
  as \`loam adopt\` reads it — an empty edge list under a map that does not parse
  is "nobody could look", never "nobody calls this"), the \`Requires:\` permissions resolved against the
  vocabulary (an undeclared entry is carried with \`declared: false\`, never
  refused — and when the vocabulary ITSELF does not read, its parse failure
  rides beside them, so \`declared: false\` there means nobody could look, not
  that the claim is wrong), the capabilities this service realizes with the
  capability vocabulary's own health beside them, maturity and provenance,
  presence pointers for the runbook/health/ADRs, and every ACTIVE feature's
  delta over this service in \`loam delta\`'s own shapes. \`--feature <FEAT>\`
  narrows the in-flight section to that one feature and is echoed back as the
  \`feature\` key, so a narrowed pack says it is one; a known feature that does
  not touch the service still projects, with empty sections and its own
  services list. Exit 1 with \`ok: true\` means a document behind the pack did
  not parse — the fleet map, a living contract, a fleet vocabulary, another
  service's spec during the capability join, or an included feature's document
  (a feature whose delta.likec4 does not parse is still INCLUDED, its errors
  in the payload, because a change nobody can read is in flight, not absent)
  — and the empty section beside the flag IS the parse failure, not "nothing
  here". Identical state yields identical bytes, so packs are diffable across
  runs.
`;
