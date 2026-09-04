/**
 * `modelShape` — which of the two shapes a `model.likec4` has, decided by a
 * byte scan of the file rather than by a config key.
 *
 * The scan decides which LOADER a service's model goes through, so both
 * mistakes are expensive and neither is a warning: a standalone model read as
 * extending is a pile of duplicate-declaration errors blamed on the fleet map
 * as well, and an extending model read as standalone is every id in it
 * unresolved. That is why the masking case below is a first-class test rather
 * than a curiosity — the adopt brief explains one shape inside a COMMENT in the
 * other shape's file, so the exact words `specification { element … }` really
 * do appear in prose in real models.
 */
import { describe, expect, it } from "vitest";
import { modelShape } from "../src/core/c4/service-model/shape.js";
import { SERVICE_MODEL } from "./helpers/harness.js";

describe("a model that declares its own element kinds stands alone", () => {
  it("says standalone for the canonical single-file model every fleet has today", () => {
    // The harness fixture IS the old shape: `specification { element … }`
    // followed by a model that re-declares its own system.
    expect(modelShape(SERVICE_MODEL)).toBe("standalone");
  });

  it("says standalone for a specification that declares a kind after tags", () => {
    expect(modelShape("specification {\n  tag critical\n  element container\n}\nmodel {\n}\n")).toBe("standalone");
  });

  it("says standalone even when the block is never closed", () => {
    // The file does not parse either way; answering `standalone` sends the
    // author to the loader whose errors name only their own file.
    expect(modelShape("specification {\n  element container\n")).toBe("standalone");
  });
});

describe("everything else extends the fleet map", () => {
  it("says extending for a tags-only specification — legal, and it lands the tag in the project", () => {
    const tagsOnly = `specification {
  tag req-AUTH
}

model {
  extend marketplace.paymentService {
    api = container 'HTTP API'
  }
}
`;
    expect(modelShape(tagsOnly)).toBe("extending");
  });

  it("says extending for a bare `model {}` and for an empty file", () => {
    expect(modelShape("model {\n}\n")).toBe("extending");
    expect(modelShape("")).toBe("extending");
  });

  it("says extending for a file that is only views", () => {
    expect(modelShape("views {\n  view of paymentService {\n    include *\n  }\n}\n")).toBe("extending");
  });

  it("does NOT read `element` out of a COMMENT — the case the mask exists for", () => {
    // The brief loam writes explains the other shape in prose, so these exact
    // words sit in a comment at the top of models that declare no kind at all.
    // Reading them would flip the whole service to the loader that cannot read
    // it, and the author would see every id in their file unresolved.
    const commented = `// A model that declares its own kinds — specification { element database } —
// is the standalone shape. This one is not.
/* Nor this: specification { element queue } */
model {
  extend marketplace.paymentService {
    api = container 'HTTP API'
  }
}
`;
    expect(modelShape(commented)).toBe("extending");
  });

  it("does NOT read `element` out of a STRING", () => {
    const quoted = `model {
  extend marketplace.paymentService {
    api = container 'specification { element database }'
  }
}
`;
    expect(modelShape(quoted)).toBe("extending");
  });
});

describe("the brace count runs over masked source, in both directions", () => {
  it("a brace inside a TITLE cannot hide a real declaration", () => {
    // The mask's other half. Counted over raw bytes, the `{` in this title
    // never closes, so the real top-level `specification` below would look
    // nested and be skipped — and a model that declares its own kind would be
    // sent to the loader that parses it BESIDE the map, where every kind it
    // declares is a duplicate blamed on the map as well.
    const braceInTitle = `model {
  extend marketplace.paymentService {
    api = container 'the { in this title'
  }
}

specification {
  element database
}
`;
    expect(modelShape(braceInTitle)).toBe("standalone");
  });

  it("a brace inside a COMMENT cannot hide one either", () => {
    const braceInComment = `// TODO: the renderer chokes on the { below
model {
}

specification {
  element database
}
`;
    expect(modelShape(braceInComment)).toBe("standalone");
  });

  it("only counts a TOP-LEVEL specification block", () => {
    // LikeC4 honours no nested `specification`, so neither may loam: a nested
    // one declares nothing, and treating it as a declaration would send a
    // perfectly good extending model to the wrong loader.
    const nested = `model {
  extend marketplace.paymentService {
    specification { element container }
  }
}
`;
    expect(modelShape(nested)).toBe("extending");
  });

  it("says extending for a specification that declares only tags, relationships and deployment nodes", () => {
    const noElements = `specification {
  tag req-AUTH
  relationship async
  deploymentNode region
}
model {
}
`;
    expect(modelShape(noElements)).toBe("extending");
  });
});
