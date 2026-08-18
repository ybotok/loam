/**
 * The host probe itself: on the machine running this suite the probe must
 * pass (the suite IS running), and the refusal it would format elsewhere is
 * pinned as text — via the exported formatter, not by mocking fs, because a
 * mocked filesystem would test the mock.
 *
 * Without this module a constrained host produces dozens of scattered
 * EPERM/EEXIST failures indistinguishable from flakes; the exit criterion
 * "fails once with a classified infrastructure reason" has no other owner.
 */
import { describe, expect, it } from "vitest";
import { hostRefusal, probeHostPrimitives } from "./helpers/host-probe.js";

describe("probeHostPrimitives", () => {
  it("passes on the host this suite is running on", async () => {
    const result = await probeHostPrimitives();
    expect(result).toEqual({ ok: true });
  });

  it("formats a refusal gate-stress classifies as infrastructure: [loam-host] first, primitive and cause named", () => {
    const text = hostRefusal({ ok: false, primitive: "link(2) hardlink", cause: "EPERM: operation not permitted" });
    expect(text.startsWith("[loam-host]")).toBe(true);
    expect(text).toContain("link(2) hardlink");
    expect(text).toContain("EPERM");
    expect(text).toContain("infrastructure failure of the host");
  });
});
