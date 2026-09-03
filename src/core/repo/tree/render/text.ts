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
 * ONE subsystem's label: the marker's `title`, or the DIRECTORY NAME when the
 * marker carries none.
 *
 * The fallback is not a nicety. Without a title LikeC4 shows the view id, and
 * the id is hex-escaped for injectivity (`subsystemViewId` says why), so every
 * subsystem whose directory name holds a hyphen — the common case — rendered
 * as `subsystem_platform__order_2dflow`. A directory name is something a human
 * chose; the escaped id never is.
 *
 * A blank or whitespace-only title counts as absent: measured, `title ''`
 * collapses to null at the model layer, so emitting one would put back exactly
 * the unlabelled view this exists to remove.
 *
 * A `/` inside the label becomes `∕` (U+2215), and that substitution is the
 * price of `viewTitle` below composing a path out of these. LikeC4 splits a
 * view title on `/` into browser folders and displays only the last segment —
 * measured: `Payments / refunds` renders as `refunds` with `Payments` demoted
 * to a folder — so an authored slash left alone would silently hide
 * half of what somebody wrote AND invent a folder level the tree does not
 * have. Since loam is the one choosing to compose with `/`, loam owns that
 * consequence rather than passing it on. The whole title stays visible and the
 * folder path stays exactly the subsystem tree. A directory name cannot
 * contain `/`, so the fallback never needs it.
 */
export function subsystemLabel(sub: SubsystemEntry): string {
  const segment = (text: string): string => likec4String(text).split("/").join("∕");
  const authored = segment(sub.meta.title ?? "");
  return authored === "" ? segment(sub.name) : authored;
}

/**
 * The title a view carries: every marked ancestor's label and its own, joined
 * with ` / ` — `Platform / Order flow` for `services/platform/order-flow`.
 *
 * LikeC4 reads that as a path: the browser shows one folder per ancestor and
 * the leaf's own label as the title, so the view list mirrors the directory
 * tree a human already navigates, and two subsystems whose leaf labels are
 * equal are told apart by their parents instead of appearing twice under one
 * name. Nothing is invented — the chain is the tree — and a subsystem directly
 * under `services/` has a chain of one and reads exactly as its own label.
 *
 * The cost, stated because it is real: renaming a PARENT's title rewrites the
 * bytes of every view beneath it, so one marker edit restales more of the file
 * than it used to. The alternative — a fixed `loam subsystems /` prefix —
 * buys the same folder without the churn and puts loam's own name in a
 * reader's UI; the tree's own words won.
 */
export function viewTitle(chain: readonly SubsystemEntry[]): string {
  return chain.map(subsystemLabel).join(" / ");
}
