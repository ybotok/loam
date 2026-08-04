import { afterEach, describe, expect, it } from "vitest";
import { analyzeDependencies } from "../src/core/dependencies.js";
import { makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";

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
        identity: "id:REQ.shared",
        features: ["FEAT-1", "FEAT-3"],
      }),
      expect.objectContaining({
        kind: "operation",
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
