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
 * Same assembly contract as every part of the `loam-codes` page:
 * ../../workflows/reference/codes.ts concatenates with NO join separator, so this
 * string starts at the first character of its opening line and ends with
 * the newline that closes its last one.
 */
export const USECASE_VIEWS = `- Business use cases are \`dynamic view\`s, and \`loam validate --all\` grades the
  ones that opt in. Write the flow in a file of its own —
  \`architecture/usecases/<name>.likec4\`, a \`views { }\` block over the landscape's
  elements, which loam reads as ONE LikeC4 project together with the map — and
  tag the view \`#cap-<capability>\` to have it graded. The tag spells a declared
  capability id with every \`/\` flattened to \`-\` (a LikeC4 tag name cannot carry a
  slash), and it must be declared as a \`tag\` in the one \`specification\` block the
  \`architecture/\` project has, since LikeC4 refuses an undeclared tag. loam grades
  the fleet map as THAT project and nothing else — the landscape plus its
  siblings, never a service model — so a hop here names SERVICE elements: a step
  naming a container that a service's extending model declares resolves in the
  renderer's wider root project and is \`landscape.invalid\` for loam, which takes
  the whole fleet map down. Container-level flows live beside the model that
  declares them (below). ANY reserved prefix
  opts a view in — a view carrying only \`#req-<requirement>\` is graded too, and
  earns \`usecase.requirement-unresolved\` for the \`#cap-\` tag it is missing
  rather than silence; so is a view carrying only \`#suite-<name>\` (below). An
  UNTAGGED dynamic view is somebody's hand-drawn diagram
  and is never graded — that opt-in is what lets a fleet full of existing
  diagrams upgrade without turning red, and \`loam validate\`, \`loam diff\`,
  \`loam delta\`, \`loam status\`, \`loam context\`, \`loam list capabilities\` and
  \`loam list suites\` all
  read the same opt-in, so a flow one of them sees is a flow all of them see. On a tagged
  view: \`usecase.capability-unresolved\`, \`usecase.step-unbacked\`,
  \`usecase.step-contested\` and \`usecase.step-unlinked\`. The first is silent
  while architecture/capabilities.yaml is absent or unreadable, like the rest of
  the capability axis; the three step codes are about the model, and a return
  hop written \`a <- b\` is attributed to the call it answers, so spell replies
  that way rather than as fresh hops. Where the map joins one pair by several
  edges naming different operations, open the step's title with the operation id
  the hop means and then punctuation —
  \`orders -> payments 'authorizePayment — authorizes the payment'\`
  (or the message it publishes or consumes) — or the hop stays
  \`usecase.step-contested\`: loam never picks one for you. Every message names
  the file the view was written in, never the landscape.
- A fleet flow says which test SUITES it runs in with \`#suite-<name>\` tags —
  a separate prefix from \`#cap-\`, many-to-many (one view may carry several),
  each declared as a \`tag suite-<name>\` in the landscape's \`specification\` so a
  typo is a parse error. Tagging is the opt-in: a view carrying ONLY \`#suite-\`
  tags is a use case and its hops are graded like any other's. To answer "which
  services must be up for suite X", run \`loam list suites smoke --json\` (or
  \`loam list suites --json\` for every suite): \`suites[]\` carries each suite's
  \`views[]\` (\`id\`, \`file\`), \`services[]\` (enumerated service ids, through the
  same element→service join the step grades use) and \`unresolved[]\` (\`element\`,
  \`external\`) — participants no service stands for, never dropped, so a stand
  that needs a double for them says so; \`ungrouped[]\` names the use cases in no
  suite, and \`useCases.state\` is \`absent\`, \`ok\` or \`unreadable\` (with
  \`error\`; \`suites\`/\`ungrouped\` are then absent, not empty). An unknown suite
  name refuses \`unknown-target\` with close names. Only the fleet map's flows
  are listed.
- A flow behind ONE service's own requirement — the hop sequence over its
  containers that an arch.spec.md \`Covers:\` names — lives in that service's own
  LikeC4 project: any \`.likec4\` beside \`services/<…>/<svc>/model.likec4\`
  (\`usecases/<name>.likec4\` by convention, or \`views.likec4\`), or a \`dynamic view\`
  inside model.likec4 itself; loam reads exactly what the renderer's per-service
  project reads. Never \`architecture/usecases/\`, which cannot resolve a container
  and turns the whole fleet \`landscape.invalid\`. Tag it \`#req-<Requirement-ID>\`
  (the id flattened as above). The tag has to be DECLARED where that project can
  see it: in model.likec4's own \`specification\` block when the model declares one
  and therefore stands alone; in \`architecture/landscape.likec4\`'s block when the
  model EXTENDS the map, or in a tags-only \`specification { tag req-… }\` beside
  the \`extend\`, which is legal and lands the tag in the project's specification.
  Declaring it in BOTH is a duplicate, and the code is the one that lands where
  the second declaration's FILE is: \`c4.invalid\` (an error, and the model's
  grading is suspended behind it) when the tags-only block is in model.likec4,
  \`usecase.flow-invalid\` when it is in a sibling. \`c4.fleet-project-invalid\` is
  the fleet-scope class one step out — two SERVICES each declaring the same tag
  locally, which no per-service project sees.
  Then \`loam validate --service <svc>\` grades it — under
  \`--all\`, per service: \`usecase.step-unbacked\` and \`usecase.step-contested\`
  against model.likec4, \`usecase.requirement-unresolved\` against THIS service's
  spec.md and arch.spec.md ids, and \`usecase.flow-invalid\` when a sibling file
  breaks the project (model.likec4 is still graded alone). \`usecase.step-unlinked\`
  never fires on a hop whose caller and provider resolve to the same service — a
  service owes no operationId to itself — while a hop from such a flow into another
  service's element (a stand-in the model declares for a sibling, with no
  \`metadata { op }\`) still warns, exactly as on the fleet map. A \`#cap-\` tag on
  such a flow is \`usecase.capability-unresolved\`: a capability is claimed on the
  fleet map, never inside one service. A resolved service-local \`#req-\` keeps its
  own grade and nothing else — it is not \`keptBy\` and not \`Covers:\`. A feature
  carries one at \`features/<FEAT>/specs/<svc>/usecases/<name>.likec4\` (below).
- A feature that MODIFIES a requirement a LIVING flow claims — an \`architecture/\`
  flow's \`#req-\` tag on a capability requirement, or a service-local flow's on
  that service's own — gets \`usecase.requirement-modified\` (warn, never gates)
  wherever the feature is graded (\`loam validate --feature\`, \`--all\` per active
  feature, \`loam status <FEAT>\`, the archive): the tag still resolves after
  the merge, so nothing else would say the drawing now answers to new words.
  Read the flow against the replacement and redraw it in the same change if it
  no longer keeps the promise — a service flow under \`usecases/\` through the
  feature's own slot (below), whose document at the same path silences the
  warning because the archive replaces the flow. A feature that REMOVES such a requirement gets
  \`usecase.requirement-unresolved\` (error, gates, \`--approve\`-overridable) in
  the same places, naming the living flow: the tag will resolve to nothing, and
  \`validate --all\` would report exactly that after the archive. Drop the tag in
  the same change, or MODIFY the requirement instead. A MODIFIED gets the same
  error, not the warning, when an id the feature adds flattens to that tag.
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
  landscape nor the delta declares; the merge preview stages no service model, so
  a container an extending model declares is not among them either). Do NOT put a
  \`dynamic view\` inside
  \`delta.likec4\`: that document re-declares the landscape's own identifiers and
  carries its own \`specification\` block, so it cannot be read beside the map, and
  the archive refuses it by name. A feature's \`delta.likec4\` keeps that shape
  whatever shape the service models take — \`features/**\` stays excluded from the
  root LikeC4 project, and the delta is pointed at alone
  (\`npx likec4 start features/<FEAT>\`).
- A FEATURE brings a SERVICE's flow beside that service's other deltas:
  \`features/<FEAT>/specs/<svc>/usecases/<name>.likec4\`, which \`loam archive\` writes
  to \`services/<…>/<svc>/usecases/<name>.likec4\` and \`loam unarchive\` takes back.
  It is graded where the feature is graded, by the grader \`validate --service\`
  runs, against the project the archive leaves: the service's model with the
  delta's interior routed into it (for a service the feature creates, the model
  the archive writes), the map for an extending model, and its living flows; and
  its \`#req-\` tags against the ids that service's spec.md and arch.spec.md have
  after the merge — an id the feature ADDS or MODIFIES resolves, one it REMOVES
  does not. A tag for an id the feature ADDS is declared by the document itself,
  a tags-only \`specification { tag req-<slug> }\` at its top, which the archive
  copies with the flow; a tag some block the project already reads declares
  must NOT be declared again (\`usecase.flow-invalid\`, a duplicate). Unlike a fleet
  flow it may REPLACE the living file at its path, and a document holding only
  comments RETIRES it — but only when EVERY requirement that living flow claims is
  one this feature MODIFIES or REMOVES (restating an unchanged one is enough),
  whose \`Based-On:\` pins then cover the redraw; otherwise \`usecase.flow-exists\`.
  An EMPTY document is neither, and is \`usecase.flow-invalid\`. A retirement naming no living flow is
  \`usecase.flow-unknown\`. \`--approve\` moves none of the three. The slot addresses
  \`usecases/\` only: a flow in \`views.likec4\` or inside model.likec4 is edited in
  place, or moved into \`usecases/\` by a direct edit first.
- \`loam delta <FEAT> --service <svc> --json\` joins the two altitudes at the hop.
  \`useCases.flows\` are the living fleet flows through the service and
  \`useCases.featureFlows\` the feature's own (\`unreadable\`/\`error\`/\`flows\`, each
  its own hole); a hop the service answers — it is called, publishes, or is
  delivered to — carries \`inside\`: \`joined\` with \`keys\` (the operation or message)
  and \`flows\` (each of the service's flows claiming, by \`#req-\`, a requirement
  whose \`Operations:\`/\`Publishes:\`/\`Consumes:\` line holds that key, with \`via\`
  naming it and \`origin\` \`living\` or \`feature\`), or \`unread\` (keys only: the
  service's flows could not be read, see \`useCases.inside\`), \`keyless\`,
  \`contested\` (with \`candidates\`) or \`unbacked\`. A \`joined\` hop with no flows is a
  fact, never a finding — loam does not ask for a flow to exist. \`useCases.redraw\`
  lists the service's living flows this feature makes untrue — \`usecase.requirement-modified\`'s
  set and the removal's — one entry per flow with its \`slot\` and its \`claims\`
  (\`requirement\`, \`change\`, \`breaks\`: null, \`unresolved\` or \`collides\`; only
  a null one may be confirmed by restating the flow unchanged), and \`loam status\`
  raises the slotted, non-breaking ones as \`next.redraw-flows\`. Nothing is
  stored: the join is read from the documents each time.
`;
