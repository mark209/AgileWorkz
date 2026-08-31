/**
 * Narrows a before/after row snapshot down to only the fields a partial
 * update DTO actually touched, so audit_logs records the real delta instead
 * of dumping the entire row on every edit.
 */
export function pickDefined<T extends object, K extends keyof T>(obj: T, keys: K[]): Partial<T> {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result;
}

/**
 * Returns the keys of a partial-update DTO that the client actually sent.
 *
 * `Object.keys(dto)` alone over-reports this: NestJS's ValidationPipe
 * (transform: true) builds `dto` via class-transformer into a real class
 * instance, and under this project's ES2022 target, TypeScript's
 * `useDefineForClassFields` default means every *declared* field on the DTO
 * class becomes an own property — defaulting to `undefined` — regardless of
 * whether the client sent it. A request with only `{ parentAssetId }` still
 * produces a `dto` where an unrelated `equipmentSystemId` field exists as an
 * own key. Filtering to `!== undefined` recovers the real set: an omitted
 * field stays `undefined` and is excluded, while an explicit `null` (used to
 * clear a nullable field, e.g. LinkAssetDto) is kept.
 */
export function changedKeysOf<T extends object>(dto: T): (keyof T)[] {
  return (Object.keys(dto) as (keyof T)[]).filter((key) => dto[key] !== undefined);
}
