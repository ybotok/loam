import { describe, expect, it } from "vitest";
import { loadSource } from "../src/core/c4/likec4.js";

const VALID = `specification {
  element system
}

model {
  payments = system 'Payments'
}
`;

const INVALID = `model {
  this is not likec4
`;

describe("LikeC4 instance lifecycle", () => {
  it("disposes both valid and invalid documents without leaking process listeners", async () => {
    const baseline = process.listenerCount("exit");

    // More than EventEmitter's default listener limit: the old implementation
    // left one listener per call and emitted MaxListenersExceededWarning here.
    for (let i = 0; i < 12; i += 1) {
      const doc = await loadSource(i % 2 === 0 ? VALID : INVALID);
      if (i % 2 === 0) {
        expect(doc.errors).toEqual([]);
        expect(doc.elements.map((element) => element.id)).toEqual(["payments"]);
      } else {
        expect(doc.errors.length).toBeGreaterThan(0);
        expect(doc.elements).toEqual([]);
        expect(doc.relationships).toEqual([]);
      }
      expect(process.listenerCount("exit")).toBe(baseline);
    }
  });
});
