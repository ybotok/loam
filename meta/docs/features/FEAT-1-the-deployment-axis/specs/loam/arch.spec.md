# loam — architecture requirement delta for FEAT-1

The rules `src/core/deployment/` establishes, in the namespace the living `arch.spec.md`
already uses. Each one is a claim about the tree that `npm run arch:check`, `npm run
meta:check` or a named test can be held to; the step order that turns them into work is in
`intent.md`, because a sequence of tasks is not an architectural rule.

## ADDED Requirements

### Requirement: The topology is read at the parsed stage and flattened before any check sees it

Requirement-ID: ARCH-LOAM-DEPLOY-READ
loam SHALL read a LikeC4 deployment model only through `parsedModel().deployment`, flatten it
into loam-neutral node, instance and relationship records inside `src/core/c4/parsed/`, and
SHALL NOT expose LikeC4's own shapes to any consumer — the containment `ARCH-LOAM-PARSED-ONLY`
already requires of the view reader, applied to the model reader beside it. The two-stage
parity that makes the cheap stage a safe substitute for the expensive one SHALL cover the
deployment records too, because a substitution nothing measures is an assumption rather than
a decision.

Covers: loam.core.c4, loam.core.deployment -> loam.core.c4

#### Scenario: The adapter is added without extending the parity pin
- **Given** the deployment records read at the parsed stage
- **When** `test/likec4-model-parity.test.ts` runs
- **Then** it compares both model stages' deployment output as well as their elements and
  relationships, so a stage that stops agreeing is a red test rather than a silent divergence

#### Scenario: The upstream shape moves
- **Given** a future LikeC4 whose deployment record the adapter cannot read
- **When** loam loads the architecture project
- **Then** it reports no topology read and every dependent check reports could-not-look, never
  nothing-wrong

#### Scenario: A consumer reaches past the adapter
- **Given** a module outside `src/core/c4/` importing LikeC4's deployment types directly
- **When** the architecture gate runs
- **Then** it fails, because the blast radius of an upstream change stays one package

### Requirement: An object that can carry an obligation tag is graded, whichever model it lives in

Requirement-ID: ARCH-LOAM-DEPLOY-TAGGED
Every check that grades a `#obl-` tag SHALL walk the deployment model as well as the logical
one. A tag is a claim about the object it sits on, and the object's model is not a property a
reader can see: today the same undeclared tag is an error on a container and silence on a
datacenter, which is fail-open — the case where a rule an architect placed does not exist for
any check, and the reviewer has no way to tell that from a rule that passed.

Covers: loam.core.deployment, loam.commands.validate -> loam.core.deployment

#### Scenario: An undeclared obligation tags a datacenter
- **Given** `#obl-geo-redundnat` on a `deploymentNode` and no such entry in
  `architecture/obligations.yaml`
- **When** `loam validate --all` runs
- **Then** `obligation.unknown` fires and names the node, exactly as it does for the same typo
  on a container

#### Scenario: A placed obligation has no requirement behind it
- **Given** `#obl-geo-redundant` on a datacenter that no living arch requirement covers
- **When** the fleet gate runs
- **Then** `deployment.uncovered` warns and names the `Covers:` entry that would answer it

#### Scenario: The fleet has no deployment model at all
- **Given** a docs repo with no `deployment { }` block anywhere
- **When** the fleet gate runs
- **Then** the whole family is silent, because the axis opts in on the block's existence the
  way the obligation vocabulary opts in on its file

### Requirement: Covers gains a fourth entry form and no fifth grammar

Requirement-ID: ARCH-LOAM-DEPLOY-COVERS
`Covers:` SHALL accept `node:<id>` beside `alert:` and `sli:`, resolved against the deployment
model, and the edge form SHALL accept the same prefix on either side. It SHALL NOT gain a
second spelling for the same object, and an entry that resolves to nothing SHALL stay
`covers.unknown` — a warning and a typo guard, never a refusal, because the line costs exactly
the coverage it was written for and nothing else.

Covers: loam.core.deployment, loam.core.c4

#### Scenario: A requirement covers a replication edge
- **Given** `Covers: node:eu.dcA.k8sA.db -> node:eu.dcB.k8sB.standby` in a living `arch.spec.md`
- **When** the service is validated
- **Then** both sides resolve and no finding is raised

#### Scenario: The covered node is renamed out from under the requirement
- **Given** the same line after the standby node is renamed in `architecture/`
- **When** the service is validated
- **Then** `covers.unknown` fires with the close ids offered, which is the acceptance criterion
  `intent.md` states

#### Scenario: A bare id is written where the prefix belongs
- **Given** `Covers: eu.dcA.k8sA` with no `node:` prefix
- **When** the entry is parsed
- **Then** it is read as an element entry and reported unresolved, because one object has one
  spelling and a silent second one would make the grammar unlearnable

### Requirement: A feature carries topology the way it carries a flow

Requirement-ID: ARCH-LOAM-DEPLOY-SLOT
`features/<FEAT>/deployment/<name>.likec4` SHALL be a create-only document that `loam archive`
copies into `architecture/` and `loam unarchive` takes back, graded before the copy against the
map the same merge would leave behind — the contract `ARCH-LOAM-FEATURE-CORPUS` already states,
and the shape `core/usecases/delta/` already implements. A document naming a file the living
tree already holds SHALL be refused rather than merged, because the merge is a whole-file copy
and rewriting a living topology belongs in a pull request where git produces the conflict. The
path SHALL be constructed through the branded feature-directory types, never assembled from
raw strings.

Covers: loam.core.deployment -> loam.core.repo, loam.core.deployment -> loam.core.kernel, loam.commands.archive -> loam.core.deployment

#### Scenario: A feature adds a standby cluster
- **Given** a feature whose `deployment/` document extends a living region with a new datacenter
- **When** the archive gate grades it
- **Then** the document resolves against the merge preview and archives as a whole-file copy

#### Scenario: The feature rewrites a living topology document
- **Given** a `features/<FEAT>/deployment/<name>.likec4` whose name the living `architecture/`
  already holds
- **When** the archive is planned
- **Then** it is refused, and `--approve` does not move it, because the loss is mechanical
  rather than a judgement

#### Scenario: The delta refusal names the slot
- **Given** a `deployment { }` block written inside `delta.likec4`
- **When** the merge is planned
- **Then** it is still refused, and the message names the feature-local slot instead of sending
  the author to the living landscape

### Requirement: The axis says what it cannot know, on the surface an agent reads

Requirement-ID: ARCH-LOAM-DEPLOY-UNCHECKED
The topology SHALL reach the context pack, and the statement of what no check will ever tell
you about it SHALL travel with it: that a green deployment axis means the documents agree with
each other, never that the second cluster exists, is reachable, or holds the data the
requirement claims. loam SHALL NOT derive topology from infrastructure descriptions, and SHALL
NOT evaluate a condition over the topology it has read — a multi-datacenter rule is an authored
requirement whose `Covers:` line names the nodes, so the fleet keeps deciding what its
architecture is and loam keeps grading only the join.

Covers: loam.core.brief, loam.core.pack -> loam.core.deployment

#### Scenario: An agent asks for the context of a feature that changes topology
- **Given** a feature touching a service whose containers are instanced in two datacenters
- **When** the context pack is built
- **Then** the topology is in it, so the implementation is written against a map that was read

#### Scenario: The unchecked list is asked what green means here
- **Given** an adoption brief printed for a fleet that has adopted the axis
- **When** the unchecked statements are read
- **Then** one of them says the deployment model is authored and unverifiable from here, beside
  the fifteen that already say the same about the rest of the map
