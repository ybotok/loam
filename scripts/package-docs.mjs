/**
 * The ONE reviewed list of package-facing documents, and the Markdown-link
 * helpers that keep those documents honest from the artifact users install.
 *
 * Three consumers, deliberately: package.json's `files[]` must set-equal
 * REVIEWED_PACKAGE_FILES (scripts/release-check.mjs blocks a release on a
 * mismatch), the installed-package smoke (scripts/package-smoke.mjs) proves
 * every shipped page's links resolve inside the tarball, and
 * test/package-docs.test.ts runs the same audit against the working tree so
 * link rot fails `npm test` before it ever reaches CI. Editing the shipped
 * document set is therefore a three-place change — files[], this list, and a
 * README pointer — and that friction is the review this module exists to force.
 * (The README pointer is owed by a top-level page, which is what a reader
 * navigates to from the front page; a directory entry like `dist` or
 * `examples` owes none, and test/package-docs.test.ts asks only of the `.md`
 * entries for exactly that reason.)
 *
 * Pure module: no top-level side effects, so both the scripts and vitest can
 * import it without running anything.
 */

/**
 * Exactly package.json's `files[]`, reviewed. `dist` ships the binary and
 * `examples` ships the runnable example fleet — the tree `loam init --example`
 * copies out, which is the only way an installed user sees loam working
 * without modelling their own system first. The Markdown pages are the ones a
 * user may reasonably open from node_modules/@ybotok/loam. Order mirrors
 * package.json for diffability: the two directory entries, then the pages.
 */
export const REVIEWED_PACKAGE_FILES = [
  "dist",
  "examples",
  "CHANGELOG.md",
  "COMPARISON.md",
  "CONTRIBUTING.md",
  "MIGRATING-from-OpenSpec.md",
  "ROADMAP.md",
  "SCHEMA.md",
  "SECURITY.md",
  "WORKFLOW.md",
];

/**
 * Every Markdown page under `examples/`, which ships as one directory entry
 * the way `dist` does.
 *
 * Enumerated rather than scanned, and the reason is the reason this module
 * exists: PACKAGED_MARKDOWN is what package-smoke.mjs set-equality-checks
 * against the Markdown the tarball actually carries, so a list derived from
 * the same tree it is meant to grade would agree with itself and prove
 * nothing. It is also the set the link audit walks — a page added to the
 * example tree and not to this list would ship with its links unchecked, and
 * the example fleet is precisely where cross-file links (the glossary
 * citations, the ADR pointing at the arch spec it is covered by) are the
 * demonstration.
 *
 * So adding a page to `examples/` adds a line here. The smoke names the exact
 * file on both sides of the mismatch.
 */
export const EXAMPLE_MARKDOWN = [
  "examples/README.md",
  "examples/docs/architecture/adrs/0001-transactional-outbox.md",
  "examples/docs/capabilities/checkout/spec.md",
  "examples/docs/capabilities/identity/tokens/spec.md",
  "examples/docs/capabilities/order-notifications/spec.md",
  "examples/docs/features/FEAT-101-payment-splitting/adrs/0001-dedicated-split-service.md",
  "examples/docs/features/FEAT-101-payment-splitting/intent.md",
  "examples/docs/features/FEAT-101-payment-splitting/specs/checkout-web/spec.md",
  "examples/docs/features/FEAT-101-payment-splitting/specs/payment-service/spec.md",
  "examples/docs/features/FEAT-101-payment-splitting/specs/payment-split-service/arch.spec.md",
  "examples/docs/features/FEAT-101-payment-splitting/specs/payment-split-service/spec.md",
  "examples/docs/features/FEAT-112-retire-order-v1/intent.md",
  "examples/docs/features/FEAT-112-retire-order-v1/specs/order-service/spec.md",
  "examples/docs/features/archive/FEAT-088-refunds/.loam-before/files/services/order-service/spec.md",
  "examples/docs/features/archive/FEAT-088-refunds/.loam-before/files/services/payment-service/spec.md",
  "examples/docs/features/archive/FEAT-088-refunds/adrs/0001-refunds-stay-in-payment-service.md",
  "examples/docs/features/archive/FEAT-088-refunds/intent.md",
  "examples/docs/features/archive/FEAT-088-refunds/specs/order-service/spec.md",
  "examples/docs/features/archive/FEAT-088-refunds/specs/payment-service/spec.md",
  "examples/docs/features/archive/FEAT-120-refund-notification/.loam-before/files/services/payment-service/spec.md",
  "examples/docs/features/archive/FEAT-120-refund-notification/.loam-before/files/services/platform/notification-service/spec.md",
  "examples/docs/features/archive/FEAT-120-refund-notification/intent.md",
  "examples/docs/features/archive/FEAT-120-refund-notification/specs/notification-service/spec.md",
  "examples/docs/features/archive/FEAT-120-refund-notification/specs/payment-service/spec.md",
  "examples/docs/glossary/order.md",
  "examples/docs/glossary/payments/authorization.md",
  "examples/docs/services/checkout-web/spec.md",
  "examples/docs/services/order-service/adrs/0001-orchestrated-order-lifecycle.md",
  "examples/docs/services/order-service/arch.spec.md",
  "examples/docs/services/order-service/runbook.md",
  "examples/docs/services/order-service/spec.md",
  "examples/docs/services/payment-service/adrs/0001-payments-outbox.md",
  "examples/docs/services/payment-service/adrs/0002-idempotency-keys-on-authorization.md",
  "examples/docs/services/payment-service/arch.spec.md",
  "examples/docs/services/payment-service/runbook.md",
  "examples/docs/services/payment-service/spec.md",
  "examples/docs/services/platform/identity-service/adrs/0001-token-introspection-over-local-validation.md",
  "examples/docs/services/platform/identity-service/arch.spec.md",
  "examples/docs/services/platform/identity-service/runbook.md",
  "examples/docs/services/platform/identity-service/spec.md",
  "examples/docs/services/platform/notification-service/runbook.md",
  "examples/docs/services/platform/notification-service/spec.md",
];

/**
 * Every Markdown page the tarball carries: the reviewed `.md` entries, plus
 * README.md, which npm includes on its own (as it does LICENSE and
 * package.json), plus the pages inside the shipped example tree. This is the
 * set the link audit walks.
 */
export const PACKAGED_MARKDOWN = [
  "README.md",
  ...REVIEWED_PACKAGE_FILES.filter((path) => path.endsWith(".md")),
  ...EXAMPLE_MARKDOWN,
];

/**
 * Files the tarball contains without being named in `files[]`, and that shipped
 * pages may therefore link relatively: npm's three automatic inclusions.
 */
export const AUTO_PACKAGED = ["README.md", "LICENSE", "package.json"];

/**
 * Blank out fenced code blocks and inline code spans, preserving offsets, so a
 * `[x](y)` inside an example is never audited as a link and a `#` inside a
 * fence is never read as a heading. Positional, like codes-drift's mask: line
 * numbers in failure messages stay true.
 */
function maskMarkdownCode(text) {
  let out = text.replace(/```[\s\S]*?(?:```|$)/g, (match) => match.replace(/[^\n]/g, " "));
  out = out.replace(/`[^`\n]*`/g, (match) => " ".repeat(match.length));
  return out;
}

/**
 * Every inline Markdown link (images included — a badge is a link too) outside
 * code, as `{ target, anchor, line }`. `target` is the path half, `""` for a
 * same-page `#anchor` link; `anchor` is `null` when the link carries none.
 * Reference-style links and angle-bracketed `](<…>)` targets are deliberately
 * unsupported: none exist in any packaged page, and an extractor that
 * half-reads them would vouch for links it never checked. auditPageLinks
 * therefore REFUSES both spellings outright rather than skipping them.
 */
export function markdownLinks(text) {
  const masked = maskMarkdownCode(text);
  const links = [];
  for (const match of masked.matchAll(/!?\[[^\]]*\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g)) {
    const raw = match[1];
    const hash = raw.indexOf("#");
    const target = hash === -1 ? raw : raw.slice(0, hash);
    const anchor = hash === -1 ? null : raw.slice(hash + 1);
    const line = masked.slice(0, match.index).split("\n").length;
    links.push({ target, anchor, line });
  }
  return links;
}

/**
 * GitHub's heading-to-anchor slug: lowercase, drop every character outside
 * [a-z0-9 _-] (backticks around code vanish, the code text stays), then turn
 * each space into a hyphen. Duplicate-heading `-1` suffixes are deliberately
 * NOT modelled — the audit refuses an anchor whose slug is ambiguous instead,
 * because a link relying on GitHub's disambiguation order is one heading
 * insertion away from pointing somewhere else.
 */
export function githubSlug(heading) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

/**
 * Every ATX heading's text, outside code fences, in document order. The mask
 * decides WHICH lines are headings (a `#` inside a fence is blanked and never
 * counts); the text is then taken from the original line, so a heading holding
 * inline code slugs over its code text rather than over the mask's spaces.
 */
export function markdownHeadings(text) {
  const originalLines = text.split("\n");
  const maskedLines = maskMarkdownCode(text).split("\n");
  const headings = [];
  for (let index = 0; index < maskedLines.length; index += 1) {
    if (!/^#{1,6}[ \t]/.test(maskedLines[index])) continue;
    headings.push(originalLines[index].replace(/^#{1,6}[ \t]+/, "").replace(/[ \t]+$/, ""));
  }
  return headings;
}

const CANONICAL_REPO = /^https:\/\/github\.com\/ybotok\/loam\/(?:blob|tree)\/main\/(.+)$/;

/**
 * What a link target IS, which decides how it is verified:
 *
 *   anchor    — same-page `#…`; the anchor must slug-match a heading here.
 *   relative  — a path; inside the tarball it must name a shipped file.
 *   canonical — https://github.com/ybotok/loam/(blob|tree)/main/<path>; the
 *               intentional way a shipped page points at repository files the
 *               tarball does not carry. `path` is the repo-relative half. Only
 *               the path is verified: a `#anchor` on a canonical link is NOT
 *               checked, because the target renders on GitHub and this audit
 *               does not model GitHub's anchor generation for arbitrary
 *               repository files (source, YAML, directory listings).
 *   external  — any other absolute URL; allowed, never fetched.
 */
export function classifyLink(target) {
  if (target === "") return { kind: "anchor" };
  const canonical = CANONICAL_REPO.exec(target);
  if (canonical !== null) return { kind: "canonical", path: canonical[1] };
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return { kind: "external" };
  return { kind: "relative", path: target };
}

/**
 * A relative link target as a package-root-relative path, resolved against the
 * directory of the page that carries it — or null when it climbs out of the
 * package altogether.
 *
 * Every audited page sat at the tarball root until `examples/` shipped, so the
 * target and the path were the same string and this function did not exist.
 * They stopped being the same the moment a page sat in a subdirectory:
 * `examples/README.md`'s `../SCHEMA.md` resolves at the tarball root and is a
 * shipped file, while the literal target `../SCHEMA.md` is a path the tarball
 * never contains — an audit reading it literally would report the one correct
 * link on that page as broken, and would resolve
 * `examples/docs/glossary/order.md`'s `payments/authorization.md` against the
 * root, where nothing of that name exists either.
 *
 * Purely lexical: these are paths inside a tarball, not paths on this disk, and
 * `..` past the root is a real failure rather than something to clamp to "".
 */
function resolveTarget(page, target) {
  const slash = page.lastIndexOf("/");
  const parts = slash === -1 ? [] : page.slice(0, slash).split("/");
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") {
      parts.push(part);
      continue;
    }
    if (parts.length === 0) return null;
    parts.pop();
  }
  return parts.join("/");
}

/**
 * Resolve `anchor` against the headings of `text`. Returns null when exactly
 * one heading slugs to it, otherwise the failure reason — quoting the computed
 * slugs, so a mismatch is diagnosable without re-deriving GitHub's rules.
 */
function anchorFailure(anchor, text) {
  const matches = markdownHeadings(text).filter((heading) => githubSlug(heading) === anchor);
  if (matches.length === 1) return null;
  if (matches.length === 0) return `anchor #${anchor} matches no heading`;
  return `anchor #${anchor} is ambiguous (${matches.length} headings slug to it)`;
}

/**
 * Audit one shipped page's links. `resolve` supplies the three facts that
 * differ between the tarball audit and the working-tree audit:
 *
 *   hasFile(path)  — does the tarball carry `path`?
 *   readDoc(path)  — the target page's text for anchor checks (null: unreadable)
 *   hasRepoPath(p) — does the canonical link's repo-relative path exist?
 *
 * The first two are asked about PACKAGE-ROOT-RELATIVE paths, never about the
 * link as written: `resolveTarget` has already resolved it against the page's
 * own directory. Both resolvers therefore stay flat lookups, which is what
 * lets the tarball audit answer from a path set and the working-tree audit
 * from the same list of shipped files.
 *
 * Returns failure strings, each naming the page, the link, and the fix.
 */
export function auditPageLinks(page, text, resolve) {
  const failures = [];
  // Fail CLOSED on the two link spellings markdownLinks() cannot read. Left
  // unrefused, a reference-style definition or an angle-bracketed target would
  // be silently skipped — a page of unaudited links reported clean.
  const masked = maskMarkdownCode(text);
  for (const match of masked.matchAll(/^\[[^\]]+\]:\s/gm)) {
    const line = masked.slice(0, match.index).split("\n").length;
    failures.push(
      `${page}:${line} reference-style link definition — this audit reads only inline [text](target) links, so it cannot vouch for reference-style ones; rewrite the link inline`,
    );
  }
  for (const match of masked.matchAll(/\]\(</g)) {
    const line = masked.slice(0, match.index).split("\n").length;
    failures.push(
      `${page}:${line} angle-bracketed link target ](<…>) — this audit reads only plain [text](target) links; drop the angle brackets (and any spaces in the path)`,
    );
  }
  for (const { target, anchor, line } of markdownLinks(text)) {
    const at = `${page}:${line}`;
    const link = anchor === null ? target : `${target}#${anchor}`;
    const classified = classifyLink(target);
    if (classified.kind === "external") continue;
    if (classified.kind === "canonical") {
      if (!resolve.hasRepoPath(classified.path)) {
        failures.push(
          `${at} canonical link ${link} names ${classified.path}, which does not exist in the repository — update the link or the prose`,
        );
      }
      continue;
    }
    if (classified.kind === "relative") {
      // Resolved against THIS page's directory, so `hasFile` and `readDoc` are
      // always asked about a package-root-relative path — the only kind either
      // resolver knows. `null` is a target that climbed out of the package.
      const path = resolveTarget(page, classified.path);
      if (path === null || !resolve.hasFile(path)) {
        failures.push(
          `${at} relative link ${link} does not resolve for an installed user — use the canonical https://github.com/ybotok/loam/blob/main/${path ?? classified.path} form, or add the file to the reviewed package list (package.json files[], scripts/package-docs.mjs, and a README pointer)`,
        );
        continue;
      }
      if (anchor !== null) {
        const targetText = resolve.readDoc(path);
        const failure = targetText === null
          ? `target ${path} is not a shipped Markdown page, so its anchors cannot be checked`
          : anchorFailure(anchor, targetText);
        if (failure !== null) failures.push(`${at} link ${link}: ${failure}`);
      }
      continue;
    }
    // Same-page anchor.
    if (anchor !== null) {
      const failure = anchorFailure(anchor, text);
      if (failure !== null) failures.push(`${at} link ${link}: ${failure}`);
    }
  }
  return failures;
}
