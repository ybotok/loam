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
  \`subsystem.views-stale\`, and also writes one create-only
  \`services/<…>/<id>/likec4.config.json\` per service model (never rewritten, never
  removed; the team may edit it; commit the new files before a \`move\`, which
  refuses over untracked paths) — the one thing that makes a model renderable
  from the docs root beside the fleet map, and the repair for
  \`service.likec4-config-missing\`. A flat fleet with no subsystems still owes
  this run: the verb is the tree's, the file is the renderer's. With more than
  one project \`likec4 validate\` at the docs root needs \`--project <name>\`
  (\`build\` and \`export\` take every project); a
  landscape view claiming a generated id is
  \`subsystem.view-id-collision\`. Each generated view is titled by its PATH —
  every marked ancestor's label and its own, which the renderer reads as
  folders — where a label is the marker's \`title\` or the directory name; the
  marker's \`description\` rides along. So editing \`subsystem.yaml\` changes
  what the renderer LABELS the group, a parent's title changes every view
  beneath it, and either makes the file stale until the next \`sync\`. It is generated wholesale:
  an authored diagram of the same services belongs in the landscape or in a
  file of your own name, never here. \`loam adopt --subsystem <name>\` briefs a new
  service's baseline directly into a group, so adoption need not land unfiled.
`;
