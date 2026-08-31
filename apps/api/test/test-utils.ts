/**
 * A deep-partial mock cast to the real type via `unknown`, never `any`.
 * `no-explicit-any` stays enabled and enforced everywhere else — this is
 * the one place mocks legitimately need to stand in for a class Nest would
 * normally construct via DI, and `unknown` keeps the cast honest (it still
 * has to be assignable through an intermediate `unknown`, unlike `any`
 * which would silently accept anything).
 */
export function mockOf<T>(partial: Record<string, unknown>): T {
  return partial as unknown as T;
}
