/**
 * The `loam flow` half of the command map — its own section module for the
 * reason `./subsystem.ts` is one: command-map.ts sits against the 300-line
 * limit and the agents-md package against the five-file cap, so each new
 * command surface's documentation lives one package down and is concatenated
 * after the map.
 *
 * Same assembly contract as every section: ../../agents-md.ts concatenates
 * with NO join separator, so this string starts at the first character of its
 * opening line and ends with the newline that closes its last one.
 */
export const FLOW_COMMANDS = `- \`loam flow <verb>\` reads the fleet's cross-service JOURNEYS — LikeC4 dynamic
  views authored one per file under \`architecture/flows/\`, which is where a
  journey has to live: the LikeC4 project is scoped to \`architecture/\` and
  excludes \`services/**\`, so a view stored under a service resolves only that
  service's own containers. A journey joins a suite by carrying a TAG (suites
  are many-to-many — one journey is in a smoke suite and a payments suite at
  once — which a directory could not say), and LikeC4 refuses an undeclared
  tag, so declaring the group once in a \`specification\` block makes a mistyped
  group a parse error instead of a second, silently empty suite. Because
  feature tags ride the same view, a group tag may NOT take the feature-id
  grammar: loam reads such a tag as the feature tag it looks like and reports
  \`flow.group-invalid\`. Verbs: \`sync\` regenerates
  \`architecture/flow-groups.likec4\` — one view per group, its members the union
  of that group's flows' participants — and is the one repair for
  \`flow.views-stale\` (it also REMOVES the file when no flow declares a group);
  \`env [group]\` answers the same union as machine output resolved to service
  IDS (never paths — a filed service's directory is wherever the subsystem tree
  puts it): which services must be up for a suite's flows to
  run, with every participant that models no service directory NAMED under
  \`unresolved\` rather than dropped. BOTH verbs then say what reached NO suite:
  everything either of them prints is per group, so a journey carrying no group
  tag is in none of it, and both close that with
  \`N of M journey(s) in no suite\` naming the ids — additive \`journeys\` and
  \`ungrouped\` keys under \`--json\`, and unfiltered even when \`env\` was given
  one group, since which journeys are unsuited is a fact about the fleet rather
  than about the suite you asked after. A view tagged ONLY with a feature id is
  unsuited too: loam reads that tag as the feature tag it looks like. It is a
  NOTE and never a finding — being in no group is legal and normal, exactly as
  an unfiled service is, so \`validate --all\` says nothing about it and nothing
  gates. Ownership inside \`architecture/\`: generated
  files are loam's (\`flow-groups.likec4\`, \`subsystems.likec4\`) and the flow
  documents are yours — never edit the generated ones, and no regenerator
  writes into \`flows/\`. Refusals: \`flow-invalid\` is a document under
  \`architecture/flows/\` that does not parse, and it refuses BOTH verbs rather
  than answering around it — an unreadable journey declares no group, so
  \`sync\` regenerating from it would delete the group views of every journey
  that IS readable, and \`env\` would answer an environment silently short of
  whatever it names; \`flow env <group>\` answers \`unknown-target\` for a group
  no flow carries, listing the ones that exist; and \`sync\` writes its one file
  through the same lock and journal as every other writer, so it answers
  \`docs-busy\`, \`commit-interrupted\`, \`merge-failed\` and
  \`rollback-incomplete\` about that commit.
`;
