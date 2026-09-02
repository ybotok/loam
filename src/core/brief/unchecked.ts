/**
 * What no check will ever tell you. Read it as the list of ways to be wrong
 * quietly. The checks that do exist — the table an adoption baseline actually
 * meets — live in checks.ts; this module is that table's counterpart, split
 * out so each half can grow without crowding the other.
 *
 * The first two entries are here because they used to be `shape` rules on
 * model.likec4, phrased exactly like the enforced ones. A brief that states an
 * unenforced rule beside four enforced ones is not merely useless — it is the
 * way an agent learns that a green `loam validate` means more than it does.
 * Anything nothing checks belongs on this list, where its status IS the point.
 */
export const UNCHECKED: string[] = [
  // Not merely unchecked — unread. This entry used to end "write one", on the
  // theory that a view is what makes a model legible. It is, to LikeC4's
  // renderer; loam computes none. Saying otherwise taught agents that a views
  // block was owed to loam, and an `include *` over the FLEET map is the one
  // shape that costs minutes rather than milliseconds.
  //
  // Still exactly true of PRESENCE, which is what this entry is about. Rule 26
  // lets loam read a dynamic view's declared steps WHERE ONE EXISTS; nothing
  // grades their absence, and the failure this comment records — agents
  // learning that a views block is owed to loam — is the one rule 26 is
  // written to prevent recurring.
  "Whether model.likec4 declares a `views { ... }` block, or any view at all — and nothing in loam ever will. What loam reads, when a `dynamic view` IS present, is only what its author declared: the view's tags and its ordered steps. It computes no view and renders nothing, and it never grades a model for lacking one — a fleet that draws no diagrams owes loam no views block, today or ever. Views belong to LikeC4's own renderer: write them if you want diagrams, and read them with `npx likec4 start <dir>` pointed at ONE directory — `services/<id>` for a service model, the docs repo root for the fleet map (`likec4.config.json` scopes that root project to `architecture/`). The renderer merges every `.likec4` file it is given into one model, and loam parses each of them alone, so each declares its own `specification` block: point it at a directory holding two of them and every declaration reads as a duplicate. Scope your views too — computing a view is superlinear in the number of edges, and an `include *` over `architecture/landscape.likec4` is the expensive one, because that file holds every call in the fleet.",
  // The readability half of the entry above. They are separate entries because
  // the failures are: one is a view that takes minutes to compute, the other is
  // a view that computes instantly and cannot be read. A fleet acquires the
  // second one the day its second service starts publishing, and every service
  // after that makes it worse by exactly one edge — which is why it arrives as
  // a surprise on a map that was fine last quarter.
  "Whether the fleet map is LEGIBLE — nothing in loam draws it, so nothing in loam notices. The shape that goes first is a shared broker: Kafka, a bus, a gateway, drawn as ONE element, is the node every service in the fleet points at, and a view over it is a star with sixty spokes. Model the TOPIC rather than the broker — `paymentEvents = topic 'payment.events'` nested inside the broker's element, with the edges pointing at `kafka.paymentEvents` — and one hub of degree sixty becomes twelve of degree five, which is also the truer model: the contract a producer and a consumer share is the topic, never the broker. Declare `element topic { #external, style { shape queue } }` in the `specification` block and give the nested elements that kind: LikeC4 does not inherit tags, so a topic under an `#external` broker is NOT external itself and `loam validate --all` asks for a `services/payment.events/` nobody owes (`landscape.service-undocumented`). Then scope the views, which is where the rest of the legibility lives: `exclude element.tag = #external` keeps the fleet overview to the calls between our own services, and a second view over the broker draws the event spine on its own.",
  "Whether the model has exactly ONE top-level element for the service, with its containers nested inside. Five top-level boxes for one service parse, validate and bind exactly as well as one — and then the fleet map, which joins elements to directories, has five candidates for the same service and no way to say which is wrong.",
  "Whether the model is the architecture the code actually has. loam parses model.likec4; it never reads a line of the service.",
  "Whether a requirement is TRUE of the service. `loam validate` checks that a requirement has a scenario, never that either one describes real behaviour.",
  "Whether the scenarios are acceptance criteria somebody could test, or the requirement restated in Given/When/Then.",
  "Whether an operationId is the one the code serves, and whether the request and response schemas resemble what the endpoint really accepts and returns. Presence is probed — an operation with no response schema at all is warned about — but what a declared schema SAYS is never compared with anything; only the operationId joins.",
  "Whether the runbook's steps work, or the health.yaml SLOs are numbers anyone agreed to.",
  "Whether an arch scenario really exercises what its `Covers:` line names. The entries are resolved against the model and health.yaml — never against code, tests, dashboards or alert rules.",
  "Whether an ADR records a decision that was made, or one reconstructed afterwards to justify the code.",
  "Whether the DEPLOYMENT model is the topology the fleet actually runs. Every join over it is between documents: `instanceOf` resolves against the C4 model, a `#obl-` tag resolves against the obligation vocabulary, and a `Covers: node:` entry resolves against the nodes the map declares. Nothing here knows whether the second cluster exists, whether it is reachable, whether replication is configured, or whether it holds the data a requirement claims — and no check counts datacenters, because how many a service needs is an architectural decision the fleet makes and writes down as a requirement, never one loam evaluates.",
  "COMPLETENESS. Forty behaviours documented as one requirement passes every check loam has. So does a service with one endpoint documented out of thirty.",
  "REPRODUCIBILITY — the bar the artifact set aims at: could a reader answer, without the code, what the service exposes, what it reaches, what shapes it exchanges, how it is run and what pages whom. The depth probes catch an EMPTY contract; nothing measures a shallow one against the service, so green means the files agree with each other, never that they reach the bar.",
  "Whether an arch requirement recording effective configuration or a library's semantics ('retries: -1 is unbounded, proven from the bytecode') is still true of the chart and the classpath. The convention names arch.spec.md as the home for such facts; loam never verifies the values.",
  "Whether a permission in `architecture/permissions.yaml` is one the system actually has. `Requires:` is checked against that file and the file against nothing: a vocabulary that agrees with every requirement citing it can still name three permissions the identity provider retired last year, and `owned_by` / `enforced_by` are read as prose — neither is resolved against `services/`, and a realm is never opened. The check is a spelling guard between documents, exactly as `Operations:` is; whether the word is real is a question only the running system answers.",
  "Whether `sources` names the files you read. loam checks those paths exist — not that they are the ones the document came from.",
];
