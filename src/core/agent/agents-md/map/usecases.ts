/**
 * The use-case axis of the command map — its own section module for
 * `./subsystem.ts`'s exact reason: command-map.ts sits against the line limit
 * and the agents-md package against the five-file cap, so a family added to the
 * `validate --all` cross-check documents itself one package down and is
 * concatenated after the map. The four `usecase.*` codes are what
 * test/codes-drift.test.ts finds here; their fix rows live in the /loam-check
 * table beside every other finding's.
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
  project has, since LikeC4 refuses an undeclared tag. An UNTAGGED dynamic view
  is somebody's hand-drawn diagram and is never graded — that opt-in is what lets
  a fleet full of existing diagrams upgrade without turning red. On a tagged
  view: \`usecase.capability-unresolved\` (error — the tag names no declared
  capability, or two declared ids collide on one slug; silent while
  architecture/capabilities.yaml is absent or unreadable, like the rest of that
  family), \`usecase.step-unbacked\` (error — a hop no relationship in the model
  backs, which LikeC4 reports nothing about, so the diagram renders and every
  other check stays green; a return hop written \`a <- b\` is attributed to the
  call it answers, so spell replies that way), \`usecase.step-contested\` (warn —
  two or more backing relationships naming different operations, every candidate
  listed in \`details\`) and \`usecase.step-unlinked\` (warn — the backing
  relationship carries no \`metadata { op }\` and no \`publishes\`/\`consumes\` while
  the hop's CALLER is not a person and its target is a real services/<id>/, so
  the flow reaches the fleet map and stops short of the contract it drives; a hop
  FROM a person is exempt — the first hop of almost every sequence diagram is
  somebody using the app, and an app owes no operationId for a click — as is a
  hop INTO anything that owns no contract). Every message names the file the
  view was written in, never the landscape.
`;
