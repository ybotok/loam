/**
 * The use-case axis of the command map — its own section module for
 * `./subsystem.ts`'s exact reason: command-map.ts sat against the file-line
 * limit and the agents-md package against the five-file cap, so a family added
 * to the `validate --all` cross-check documents itself one package down and is
 * concatenated after the map. The four `usecase.*` codes are what
 * test/codes-drift.test.ts finds here.
 *
 * They are LISTED and not glossed: their fix rows live in the /loam-check
 * table and `loam explain usecase.step-unbacked` prints them, so writing the
 * meanings out again here is the duplication ../../command-map.ts's header
 * describes. What stays is what `explain` does not say — how to opt a view in,
 * and that an untagged dynamic view is never graded at all.
 *
 * Same assembly contract as every section: ../../agents-md.ts concatenates with
 * NO join separator, so this string starts at the first character of its opening
 * line and ends with the newline that closes its last one.
 */
export const USECASE_VIEWS = `- Business use cases are \`dynamic view\`s, and \`loam validate --all\` grades the
  ones that opt in. Write the flow in a file of its own —
  \`architecture/usecases/<name>.likec4\`, a \`views { }\` block over the landscape's
  elements, which loam reads as ONE LikeC4 project together with the map — and
  tag the view \`#cap-<capability>\` to have it graded. The tag spells a declared
  capability id with every \`/\` flattened to \`-\` (a LikeC4 tag name cannot carry a
  slash), and it must be declared as a \`tag\` in the one \`specification\` block the
  project has, since LikeC4 refuses an undeclared tag. EITHER reserved prefix
  opts a view in — a view carrying only \`#req-<requirement>\` is graded too, and
  earns \`usecase.requirement-unresolved\` for the \`#cap-\` tag it is missing
  rather than silence. An UNTAGGED dynamic view is somebody's hand-drawn diagram
  and is never graded — that opt-in is what lets a fleet full of existing
  diagrams upgrade without turning red, and \`loam validate\`, \`loam diff\`,
  \`loam delta\`, \`loam status\`, \`loam context\` and \`loam list capabilities\` all
  read the same opt-in, so a flow one of them sees is a flow all of them see. On a tagged
  view: \`usecase.capability-unresolved\`, \`usecase.step-unbacked\`,
  \`usecase.step-contested\` and \`usecase.step-unlinked\`. The first is silent
  while architecture/capabilities.yaml is absent or unreadable, like the rest of
  the capability axis; the three step codes are about the model, and a return
  hop written \`a <- b\` is attributed to the call it answers, so spell replies
  that way rather than as fresh hops. Every message names the file the view was
  written in, never the landscape.
- A FEATURE brings a flow the way it brings every other axis: write it at
  \`features/<FEAT>/usecases/<name>.likec4\` — the same views-only document, in the
  feature's own directory — and \`loam archive\` copies it into
  \`architecture/usecases/\` while \`loam unarchive\` takes it back. That is what lets
  an analyst add a cross-service requirement and an architect answer it with the
  flow that keeps it IN ONE CHANGE: the \`#req-\` tag resolves against this
  feature's own \`capabilities/<cap>/spec.md\` delta as well as the living tree, and
  \`capability.uncovered\` counts the flow as cover. The flow is graded against the
  map the same merge would leave behind, so a hop may name a service this
  feature's \`delta.likec4\` adds. Two refusals guard it, and \`--approve\` moves
  neither: \`usecase.flow-exists\` (the living \`architecture/usecases/\` already has
  that file — the merge is a whole-file copy, so edit the living one directly
  instead) and \`usecase.flow-invalid\` (loam could not read the flows against that
  post-merge map — most often a hop naming an element neither the living
  landscape nor the delta declares). Do NOT put a \`dynamic view\` inside
  \`delta.likec4\`: that document re-declares the landscape's own identifiers and
  carries its own \`specification\` block, so it cannot be read beside the map, and
  the archive refuses it by name.
`;
