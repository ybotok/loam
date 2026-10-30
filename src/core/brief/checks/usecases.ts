/**
 * The brief's check rows for a service's OWN use cases — the flows beside its
 * model — concatenated into `VALIDATE_CHECKS` at the place they always stood
 * (`./checks.ts`). Their own module because the table outgrew its file limit
 * the day a fourth reserved prefix gave them a fourth placement row, and these
 * rows are the one block of it with a subject of their own.
 */
import { VIA_SERVICE, type BriefCheck } from "./check.js";

/** The service-target use-case codes an adopting agent's own baseline run can report. */
export const SERVICE_USECASE_CHECKS: BriefCheck[] = [
  // The service's OWN use cases: a `dynamic view` in any `.likec4` beside
  // model.likec4 (or inside it) that opts in with `#req-`. The same codes the
  // fleet target grades over architecture/usecases/, reused on the service
  // target because the flow's hops name this service's containers, which only
  // its own project can resolve. `usecase.step-unlinked` was at first left
  // out, on the reasoning that a hop between two containers of one service
  // owes no operationId — true, and exactly the scope of the guard that keeps
  // it quiet there (a service owes none to itself); but a service's model
  // routinely declares a stand-in for a sibling service it calls, and a hop
  // from a service-local flow into that stand-in with no `metadata { op }`
  // warns exactly as it does on the fleet map. The row is listed so the
  // agent's own baseline run never reports a code the brief left unexplained.
  {
    code: "usecase.step-unbacked",
    severity: "error",
    via: VIA_SERVICE,
    what: "a hop of a `#req-`-tagged dynamic view in this service's project that no relationship in model.likec4 backs — LikeC4 reports nothing for it, so only this does",
  },
  {
    code: "usecase.step-contested",
    severity: "warn",
    via: VIA_SERVICE,
    what: "two or more relationships back one hop of a service-local flow and name different operations, and the step's title opens with none of their operation ids or message names — loam names the candidates rather than picking one; opening the title with the one the hop means, then punctuation, is how the author picks",
  },
  {
    code: "usecase.step-unlinked",
    severity: "warn",
    via: VIA_SERVICE,
    what: "a hop of a service-local flow into ANOTHER service's element — a stand-in this model.likec4 declares for a sibling, bound or titled as that service — backed by an edge carrying no `metadata { op }` and no `publishes`/`consumes`; never on a hop whose caller and provider resolve to the same service, because a service owes no operationId to itself",
  },
  {
    code: "usecase.requirement-unresolved",
    severity: "error",
    via: VIA_SERVICE,
    what: "a `#req-` tag on a service-local flow naming no `Requirement-ID` of this service's spec.md or arch.spec.md — the id is scoped by the directory, never by a capability",
  },
  {
    code: "usecase.capability-unresolved",
    severity: "error",
    via: VIA_SERVICE,
    what: "a `#cap-` tag on a flow inside this service's own project — a capability is claimed on the fleet map, never inside one service; drop the tag and keep the `#req-` one",
  },
  {
    code: "usecase.obligation-misplaced",
    severity: "error",
    via: VIA_SERVICE,
    what: "an `#obl-` tag on a flow inside this service's own project — a flow's obligation tag applies to the hops of a FLEET flow, and inside one service the obligation is met by the arch requirement whose `Covers:` names it; drop the tag and keep that requirement's `#req-`",
  },
  {
    code: "usecase.flow-invalid",
    severity: "error",
    via: VIA_SERVICE,
    what: "a `.likec4` beside model.likec4 that does not parse as part of the service's LikeC4 project — no flow in it was graded; model.likec4 itself is still graded alone",
  },
];
