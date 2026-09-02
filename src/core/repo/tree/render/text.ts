/**
 * Somebody else's words, made safe to write into a `.likec4` file.
 *
 * The generated views file carries FREE TEXT for the first time — a
 * subsystem's `title` and `description`, straight out of `subsystem.yaml` —
 * and this module is the only place in loam where a person's prose becomes
 * syntax. It sits in its own module beside the body renderer because both the
 * file-level render (`../views.ts`, the view's own `title` line) and the box
 * render (`./body.ts`, a group's label) must escape the same way; two
 * spellings would be two chances to differ, and the one that forgot would ship
 * a fleet-wide parse error.
 */
import type { SubsystemEntry } from "../walk.js";

/**
 * One string, safely spelled as a LikeC4 single-quoted literal.
 *
 * The marker reader validates that a `title` is a string and nothing else
 * (`../marker.ts`), so every measurement below is reachable from a
 * `subsystem.yaml` a human may legally write, against the pinned likec4:
 *
 *  - a raw `'` is 2 parse errors, and a parse error in ONE document of the
 *    `architecture/` project blanks the model for every document in it — a
 *    fleet would lose its whole map over one apostrophe in a marker;
 *  - a trailing lone `\` is 3 errors (it escapes the closing quote);
 *  - `C:\path` written raw is 0 errors and a quietly wrong `C:path` label;
 *  - `Ops' } view evil { include x` is 0 errors and INJECTS a view — and an
 *    injected id equal to an authored one silently replaces that author's
 *    view in the rendered project. That one is the reason this function is
 *    not optional.
 *
 * Normalize, then escape, and in that order: every run of control or space
 * characters collapses to one space, because the file's contract is
 * line-oriented (`../views.ts`'s header states the git-merge property in
 * lines) and a literal newline inside an emitted string would split
 * `title '…'` in two. Then `\` before `'`, because doubling the backslashes
 * afterwards would double the ones this function itself inserted.
 */
export function likec4String(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Zs}\p{Zl}\p{Zp}]+/gu, " ")
    .trim()
    .split("\\")
    .join("\\\\")
    .split("'")
    .join("\\'");
}

/**
 * The label a human reads in the renderer: the marker's `title`, or the
 * DIRECTORY NAME when the marker carries none.
 *
 * The fallback is not a nicety. Without a title LikeC4 shows the view id, and
 * the id is hex-escaped for injectivity (`subsystemViewId` says why), so every
 * subsystem whose directory name holds a hyphen — the common case — rendered
 * as `subsystem_api__rest_2dapi_2dv2_2dservices`. A directory name is
 * something a human chose; the escaped id never is.
 *
 * A blank or whitespace-only title counts as absent: measured, `title ''`
 * collapses to null at the model layer, so emitting one would put back exactly
 * the unlabelled view this exists to remove.
 */
export function viewTitle(sub: SubsystemEntry): string {
  const authored = likec4String(sub.meta.title ?? "");
  return authored === "" ? likec4String(sub.name) : authored;
}
