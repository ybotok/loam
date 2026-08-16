import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { analyzeDependencies } from "../src/core/dependencies/dependencies.js";
import { FleetContext } from "../src/core/fleet-context.js";
import { makeProject, runLoam, treeHashes, writeFiles, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

function spec(kind: "ADDED" | "MODIFIED", id: string, name: string, operation?: string): string {
  return `## ${kind} Requirements

### Requirement: ${name}
Requirement-ID: ${id}
${operation === undefined ? "" : `Operations: ${operation}\n`}
#### Scenario: Works
- **WHEN** exercised
- **THEN** it works
`;
}

function api(operationId: string): string {
  return `openapi: 3.1.0
info: { title: svc, version: "1" }
paths:
  /x:
    post:
      operationId: ${operationId}
      responses:
        "200": { description: ok }
`;
}

/**
 * One feature whose only delta edge carries `authorizePayment` onto an element
 * BOUND to `target` — the `metadata { service '…' }` text a document declares,
 * which is the string the graph turns into `services/<target>/openapi.yaml` to
 * ask what the target already provides. The fleet's one real service sits
 * beside it so the enumeration the resolution goes through is non-empty and
 * simply does not contain `target`.
 */
async function edgeTargeting(target: string): Promise<Project> {
  const project = await makeProject({
    "services/payment-service/openapi.yaml": api("authorizePayment"),
    "features/FEAT-1-consumer/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-1
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  callee = softwareSystem 'callee' {
    metadata { service '${target}' }
  }

  checkoutWeb -> callee 'Calls authorizePayment' {
    #FEAT-1
    metadata { op 'authorizePayment' }
  }
}

views {
  view feat_1 {
    include *
  }
}
`,
  });
  cleanups.push(() => project.destroy());
  return project;
}

async function dependencyProject(): Promise<Project> {
  const project = await makeProject({
    "features/FEAT-1-provider/specs/svc/spec.md": spec("ADDED", "REQ.shared", "Shared requirement"),
    "features/FEAT-1-provider/specs/svc/openapi.yaml": api("createShared"),
    "features/FEAT-2-consumer/specs/svc/spec.md": spec("MODIFIED", "REQ.shared", "Renamed safely", "createShared"),
    "features/FEAT-3-rival/specs/svc/spec.md": spec("ADDED", "REQ.shared", "Shared requirement"),
    "features/FEAT-3-rival/specs/svc/openapi.yaml": api("createShared"),
  });
  cleanups.push(() => project.destroy());
  return project;
}

describe("typed active-feature dependency analyzer", () => {
  it("derives requirement and operation edges plus duplicate-add conflicts", async () => {
    const project = await dependencyProject();

    const graph = await analyzeDependencies(project.docsDir);

    expect(graph.nodes.map((node) => node.id)).toEqual(["FEAT-1", "FEAT-2", "FEAT-3"]);
    expect(graph.edges.filter((edge) => edge.from === "FEAT-2")).toEqual([
      expect.objectContaining({ from: "FEAT-2", to: "FEAT-1" }),
      expect.objectContaining({ from: "FEAT-2", to: "FEAT-3" }),
    ]);
    const reasons = graph.edges.flatMap((edge) => edge.reasons);
    expect(reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "requirement", identity: "id:REQ.shared" }),
      expect.objectContaining({ kind: "operation", operationId: "createShared" }),
    ]));
    expect(graph.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "requirement",
        change: "added",
        identity: "id:REQ.shared",
        features: ["FEAT-1", "FEAT-3"],
      }),
      expect.objectContaining({
        kind: "operation",
        change: "added",
        identity: "createShared",
        features: ["FEAT-1", "FEAT-3"],
      }),
    ]));
    expect(graph.order.indexOf("FEAT-1")).toBeLessThan(graph.order.indexOf("FEAT-2"));
    expect(graph.order.indexOf("FEAT-3")).toBeLessThan(graph.order.indexOf("FEAT-2"));
  });

  it("CLI focus includes transitive prerequisites, uses JSON v1.0, and writes nothing", async () => {
    const project = await dependencyProject();
    const before = await treeHashes(project.docsDir);

    const result = await runLoam(project.workDir, "dependencies", "FEAT-2", "--json");
    const graph = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    expect(graph).toMatchObject({
      contractVersion: "1.0",
      ok: true,
      command: "dependencies",
      feature: "FEAT-2",
    });
    expect(graph.nodes.map((node: { id: string }) => node.id)).toEqual(["FEAT-1", "FEAT-2", "FEAT-3"]);
    expect(await treeHashes(project.docsDir)).toEqual(before);
  });

  it("detects cycles deterministically", async () => {
    const project = await makeProject({
      "features/FEAT-1-a/specs/svc/spec.md": `${spec("ADDED", "REQ.a", "A")}\n${spec("MODIFIED", "REQ.b", "B")}`,
      "features/FEAT-2-b/specs/svc/spec.md": `${spec("ADDED", "REQ.b", "B")}\n${spec("MODIFIED", "REQ.a", "A")}`,
    });
    cleanups.push(() => project.destroy());

    const graph = await analyzeDependencies(project.docsDir);

    expect(graph.cycles).toEqual([["FEAT-1", "FEAT-2"]]);
  });

  it("carries the collision kind in the envelope, so a consumer can tell the two fixes apart", async () => {
    const project = await makeProject({
      "services/svc/spec.md": `---\nservice: svc\n---\n\n# svc\n\n## Requirements\n\n${spec("ADDED", "REQ.cancel", "Cancel an order").split("\n").slice(2).join("\n")}`,
      "features/FEAT-1-a/specs/svc/spec.md": spec("MODIFIED", "REQ.cancel", "Cancel an order"),
      "features/FEAT-2-b/specs/svc/spec.md": spec("MODIFIED", "REQ.cancel", "Cancel an order"),
    });
    cleanups.push(() => project.destroy());

    const result = await runLoam(project.workDir, "dependencies", "--json");
    const graph = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    // Two features rewriting one living requirement: no edge between them (both
    // depend on the living state, not on each other) — the collision only shows
    // up as a conflict, and only if the graph indexes changes as well as adds.
    expect(graph.edges).toEqual([]);
    expect(graph.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "requirement",
        change: "changed",
        identity: "id:REQ.cancel",
        features: ["FEAT-1", "FEAT-2"],
      }),
    ]));
    expect(graph.conflicts.every((c: { change: string }) => c.change === "changed")).toBe(true);
  });

  it("a delta target that resolves outside the docs repo is graded as absent, its contract unread", async () => {
    // `metadata { service '../../outside-svc' }` parses in LikeC4 without one
    // error, and the graph asks "does the target already provide this op?" by
    // spelling `services/<target>/openapi.yaml` — so before the enumeration
    // bridge that probe landed OUTSIDE the docs repo, and a contract sitting
    // out there answered for a service the fleet does not have. Nothing in the
    // graph's OUTPUT could show it: the edge is spelled with the declared name
    // and no feature can own an operation under a name with a slash in it, so
    // the reachable fact is the read itself.
    const escaped = await edgeTargeting("../../outside-svc");
    await writeFiles(join(escaped.docsDir, ".."), {
      "outside-svc/openapi.yaml": api("authorizePayment"),
    });
    // The trap, armed and checked: a typo in the traversal above would leave
    // every assertion below passing for no reason at all.
    expect(existsSync(join(escaped.docsDir, "services", "../../outside-svc", "openapi.yaml"))).toBe(true);
    const before = await treeHashes(join(escaped.docsDir, ".."));

    const context = new FleetContext();
    const graph = await analyzeDependencies(escaped.docsDir, undefined, context);

    // Not one contract was opened: an unresolvable target never becomes a
    // path, so there is nothing to read — the outside one least of all. This
    // counted 1 before the fix, and that 1 was the file above the repo.
    expect(context.stats().openapiParses).toBe(0);
    expect(graph.nodes.map((node) => node.id)).toEqual(["FEAT-1"]);
    expect(graph.edges).toEqual([]);

    // The control: the same edge aimed at a service that simply is not there.
    // A name that escapes the repo must be indistinguishable from an absent
    // one, in the graph and in what it cost to build it.
    const ghostProject = await edgeTargeting("ghost-svc");
    const ghostContext = new FleetContext();
    const ghost = await analyzeDependencies(ghostProject.docsDir, undefined, ghostContext);

    expect(ghostContext.stats().openapiParses).toBe(0);
    expect(graph).toEqual(ghost);

    // And the command itself: same answer, and the tree it was pointed at —
    // the docs repo AND the directory above it — byte for byte as it was.
    const result = await runLoam(escaped.workDir, "dependencies", "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, edges: [], conflicts: [] });
    expect(await treeHashes(join(escaped.docsDir, ".."))).toEqual(before);
  });

  it("fails cleanly for an archived or unknown focus", async () => {
    const project = await dependencyProject();
    const result = await runLoam(project.workDir, "dependencies", "FEAT-404", "--json");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      contractVersion: "1.0",
      ok: false,
      error: { code: "unknown-target" },
    });
  });
});
