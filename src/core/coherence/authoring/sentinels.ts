/**
 * The placeholder strings `loam new` scaffolds, spelled ONCE.
 *
 * Both sides of the placeholder gate read this module: the templates in
 * `commands/new/templates.ts` write these exact strings, and the coherence
 * check in `./scaffold.ts` refuses to archive them. Spelling a sentinel in two
 * places is how the gate stops matching the scaffold — a one-character rewording
 * of a template would silently retire the check that guards it.
 *
 * Detection is EXACT on purpose. A requirement whose author genuinely writes
 * "TODO" in prose is that author's call to make; only the strings loam itself
 * scaffolded are ones nobody wrote.
 */

/** The scaffolded business-requirement heading (`specs/<svc>/spec.md`). */
export const REQUIREMENT_SENTINEL = "TODO — name the behaviour";

/** The scaffolded architecture-requirement heading (`specs/<svc>/arch.spec.md`). */
export const ARCH_REQUIREMENT_SENTINEL = "TODO — name the architectural obligation";

/** The scaffolded scenario heading, shared by both spec axes. */
export const SCENARIO_SENTINEL = "TODO — name the case";

/** The scaffolded description on a `--new-service` element in delta.likec4. */
export const SERVICE_DESCRIPTION_SENTINEL = "TODO — what this service owns";

/** The scaffolded SHALL fill-in on the business axis. */
export const SHALL_SENTINEL = "<observable behaviour, testable without reading the code>";

/** The scaffolded SHALL fill-in on the architecture axis. */
export const ARCH_SHALL_SENTINEL = "<the operational/integration behaviour, observable in test>";

/** The scaffolded Given/When/Then fill-ins, shared by both spec axes. Three
 * constants rather than one keyed object because a `then` property makes an
 * object thenable — one accidental `await` away from a hang the linter
 * refuses outright. */
export const GIVEN_SENTINEL = "<the starting state>";
export const WHEN_SENTINEL = "<the trigger>";
export const THEN_SENTINEL = "<the observable outcome>";

/**
 * The angle-bracket fill-ins inside scaffolded requirement bodies and steps.
 * Any one of them surviving to archive means the line around it was never
 * authored — the brackets are the template telling the author what to replace.
 */
export const BODY_SENTINELS: readonly string[] = [
  SHALL_SENTINEL,
  ARCH_SHALL_SENTINEL,
  GIVEN_SENTINEL,
  WHEN_SENTINEL,
  THEN_SENTINEL,
];

/** Every scaffolded heading a requirement or scenario may still carry. */
export const HEADING_SENTINELS: readonly string[] = [
  REQUIREMENT_SENTINEL,
  ARCH_REQUIREMENT_SENTINEL,
  SCENARIO_SENTINEL,
];
