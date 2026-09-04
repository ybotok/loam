/**
 * The `loam subsystem` half of the command map — its own section module
 * because command-map.ts sat against the file-line limit and the agents-md
 * package against the five-file cap, so the tree surface's documentation
 * lives one package down and is concatenated after the map.
 *
 * Same assembly contract as every section: ../agents-md.ts concatenates with
 * NO join separator, so this string starts at the first character of its
 * opening line and ends with the newline that closes its last one.
 */
export const SUBSYSTEM_COMMANDS = `- \`loam subsystem <verb>\` manages the grouping tree under \`services/\` — the
  navigable tree no identity depends on: a service id stays its leaf directory
  name, every join key is byte-identical before and after a move, and the tree
  carries no policy. Verbs: \`new <name> [--under <sub>] [--title] [--description]
  [--owner]\` creates a group (an empty one is legal — its \`subsystem.yaml\` is a
  marker, never a member list); \`move <name>... --into <sub|.>\` relocates
  services and whole subtrees in ONE journaled transaction over the renames
  plus the regenerated views file (\`--into .\` unfiles; the renames and the
  regenerated views file are staged in git without committing, where git answers); \`rename <old> <new>\` renames a
  group through the same transaction (services are never renamed — the id is
  the identity); \`rm <name>\` removes an EMPTY group; \`list\` shows the tree
  with member counts and the unfiled count (unfiled is permanent and normal —
  a count, never a finding; \`loam list --json\` carries the same facts as
  additive keys \`services[].subsystem\`, \`subsystems[]\` and
  \`unfiledServices\`); \`history <name>\` asks git how a service or subsystem
  moved and answers nothing — exit 0, no finding — when git will not say;
  \`sync\` regenerates \`architecture/subsystems.likec4\`, the one repair for
  \`subsystem.views-stale\`, and also maintains the RENDERER's wiring for the
  service models. Which wiring a model needs is decided by the file's own
  grammar, never by a config key: a model that declares its own
  \`specification { element … }\` block STANDS ALONE — it cannot share a project
  with the fleet map, since every kind it declares would be a duplicate there —
  and a model with no such block EXTENDS the map with
  \`extend <fully-qualified id> { … }\` and parses only INSIDE the root project.
  So \`sync\` writes one create-only \`services/<…>/<id>/likec4.config.json\` per
  STANDALONE model (never rewritten; the team may edit it; commit
  the new files before a \`move\`, which refuses over untracked paths), DELETES one
  sitting beside an EXTENDING model (that nested project claims the model out of
  the root project, so \`likec4 validate .\` refuses without \`--project\` and,
  wherever that project claims the model, \`export json --project fleet\` loses
  the service's containers; \`--json\` lists what it removed as \`projects.removed\`), and rewrites
  the root \`likec4.config.json\`'s \`exclude\` to hold \`services/<tree>/**\` for
  exactly those models, keeping every entry that is not about \`services/\` in the
  order the team wrote it. It rewrites that list when at least one extending model
  exists, or when a standalone model's directory is not covered — an older repo
  whose models all stand alone behind \`services/**\` is never touched. \`--json\`
  carries the result as \`projects.exclude\`, and the text view prints one line when
  it rewrote. Between them these repair four warnings:
  \`service.likec4-config-missing\` (a standalone model with no project file),
  \`service.likec4-config-stray\` (a project file beside an extending model),
  \`service.model-excluded\` (an extending model the root \`exclude\` hides from the
  renderer) and \`service.model-unexcluded\` (a standalone model it does not hide,
  which blanks the whole root project). A flat fleet with no subsystems still owes
  this run: the verb is the tree's, the files are the renderer's. A fleet whose
  models all extend the map ends with ONE project and one picker entry, and
  \`likec4 validate\` at the docs root needs no flag; each standalone model adds a
  project, and with more than one \`likec4 validate\` needs \`--project <name>\`
  (\`build\` and \`export\` take every project). A view id claimed twice inside one
  project — the landscape and an extending model both minting it, or either
  claiming a generated one — is
  \`subsystem.view-id-collision\`. Each generated view is titled by its PATH —
  every marked ancestor's label and its own, which the renderer reads as
  folders — where a label is the marker's \`title\` or the directory name; the
  marker's \`description\` rides along. So editing \`subsystem.yaml\` changes
  what the renderer LABELS the group, a parent's title changes every view
  beneath it, and either makes the file stale until the next \`sync\`. The
  generated file is NEVER part of the fleet-project load
  (\`c4.fleet-project-invalid\` reads every other \`.likec4\` the root project holds);
  \`subsystem.views-stale\` is the only check that reads it, by byte comparison.
  Each view
  carries \`global style subsystems\` — written after its title, the one line
  LikeC4 gives a view for borrowing a palette — exactly when the \`architecture/\`
  project declares a global style with that id (\`global { styleGroup subsystems
  { style element.tag = #external { color gray } } }\`, in the landscape or in
  ANY \`.likec4\` under \`architecture/\` the root \`exclude\` does not cover — a
  \`palette.likec4\` beside the map counts); nothing otherwise, and loam never reads
  what the group says. Declaring it is the whole opt-in and makes the file stale
  once, until the next \`sync\`. When the project declares style groups under other
  names only, the file opens with one comment line naming them and saying none is
  \`subsystems\`, and the views carry the renderer's defaults — so declaring a group
  under ANY name restales the file, because that comment is part of the bytes.
  \`sync\` refuses to rewrite it at all while \`architecture/\` does not parse
  (\`action: "blocked"\`): fix the map first. It is generated wholesale:
  an authored diagram of the same services belongs in the landscape or in a
  file of your own name, never here. \`loam adopt --subsystem <name>\` briefs a new
  service's baseline directly into a group, so adoption need not land unfiled.
`;
