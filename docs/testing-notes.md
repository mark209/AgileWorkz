# Testing Notes — Known Non-Blocking Issues

## Jest "worker process has failed to exit gracefully" (Phase 2, Steps 4–5)

**Symptom:** `pnpm --filter @agileworks/api test` occasionally prints:

```
A worker process has failed to exit gracefully and has been force exited.
This is likely caused by tests leaking due to improper teardown. Try running
with --detectOpenHandles to find leaks. Active timers can also cause this,
ensure that .unref() was called on them.
```

**Status:** Non-blocking. Every run affected by this warning still reports
exit code `0` with all test suites and all individual tests passing — it has
never coincided with a test failure, on either the implementation side or in
the user's independent local verification.

**Observed pattern:** First seen partway through Phase 2 (Step 4), recurred
in Step 5. Frequency appears to track total suite count/runtime rather than
any specific file — it did not reproduce consistently across repeated runs
of the same suite set, and no single new test file introduced in Steps 3–5
correlates with it appearing or not.

**Suspected cause (unconfirmed):** Likely Jest/Windows worker-pool teardown
overhead under system load (multiple concurrent dev-server processes were
running locally throughout Phase 2 implementation), not a leak in
application code — none of the Phase 2 unit tests open real timers,
sockets, or database connections; they exercise services against a mocked
`PrismaService` only.

**Action taken:** None yet — deliberately deferred per explicit instruction
not to spend unrelated implementation time investigating it unless it
becomes blocking (a real test failure, not just the warning).

**If it needs to be revisited later:** start with `jest --detectOpenHandles`
on the full `apps/api` suite to identify the actual open handle, rather than
guessing.
