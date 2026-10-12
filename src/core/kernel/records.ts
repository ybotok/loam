/**
 * The shapes an unknown parsed document is asked about, in one place.
 *
 * Every YAML and JSON file loam reads arrives as `unknown`, and every reader
 * has to answer the same first question before it can look at a key: is this an
 * object at all? Six modules each carried their own copy of the answer, two of
 * them spelled with a cast — and a cast is exactly what this test exists to
 * make unnecessary, since the predicate form hands the caller a narrowed type
 * that tsc keeps checking. A leaf with no imports, so any layer can ask.
 */

/** An object with string keys — not null, and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The same question where the answer is used rather than branched on. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/**
 * A list of strings. `Array.isArray` narrows an `unknown` to `any[]`, so an
 * element check written below it proved nothing to tsc and the elements had to
 * be asserted back to `string` at the point of use — how a checked element
 * type went on being asserted back in a line later. Deciding both halves in
 * one predicate makes the narrowing carry the check. (It was written twice,
 * once in the OpenSpec scan and once in the migration's mapping reader.)
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * A map whose keys come from a document somebody else wrote.
 *
 * `Object.create(null)` rather than `{}` because a key read out of untrusted
 * YAML can be `__proto__` or `constructor`, and on a normal object those either
 * mutate the prototype or read back a function that was never in the file.
 */
export function dictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** The value a record actually holds for `key`, never one it inherited. */
export function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
