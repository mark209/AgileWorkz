# `auth_sessions` — Approved Security Enhancement (Not Yet Implemented)

**Status:** Approved in principle. No schema change has been made. This is
recorded here to be implemented in the next controlled schema revision —
not part of the Phase 1 platform tables (`users`, `user_roles`, `roles`,
`permissions`, `role_permissions`, `system_settings`, `audit_logs`).

## Why

Phase 1 ships stateless JWT refresh tokens with no server-side record. That
means logout, forced revocation, and status-driven session termination are
all impossible to enforce before a token's natural expiry. `auth_sessions`
closes that gap without touching how access tokens work.

## Table

`auth_sessions` — represents an authenticated login/device session, not
merely a token (hence the name, per approved revision — not
`refresh_tokens`).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `user_id` | uuid, FK → `users.id` | |
| `refresh_token_hash` | string, unique, indexed | SHA-256 of the actual refresh token. **The raw token is never stored** — same principle as `users.password_hash`. |
| `issued_at` | timestamptz | |
| `expires_at` | timestamptz | |
| `revoked_at` | timestamptz, nullable | |
| `revoked_reason` | string, nullable | `logout` / `rotated` / `admin_revoked` / `password_changed` / `status_changed` / `reuse_detected` |
| `replaced_by_id` | uuid, FK → self, nullable | rotation chain |
| `ip_address` | string, nullable | |
| `user_agent` | string, nullable | |
| `created_at` | timestamptz | |

Indexes: unique(`refresh_token_hash`), index(`user_id`), index(`user_id`, `revoked_at`).

## Behavior (unchanged from what was approved)

- Access tokens remain stateless, short-lived JWTs — no DB lookup added to
  every authenticated request. Only the refresh path becomes stateful.
- Refresh: hash the presented token, look up the row, require unrevoked +
  unexpired + `user.status = ACTIVE`, then **rotate** — issue a new token/row,
  mark the old one `revoked_reason = 'rotated'`, set `replaced_by_id`.
- A revoked/rotated token being presented again is treated as a reuse/theft
  signal: revoke every session for that user and log it, not just deny the
  one request.
- Logout revokes that one row (`revoked_reason = 'logout'`).
- A status change to `INACTIVE`/`SUSPENDED` revokes all of that user's
  active rows immediately (`revoked_reason = 'status_changed'`), in addition
  to the existing ACTIVE check already blocking new refreshes today.
- A future password/credential-change endpoint revokes all sessions except
  optionally the one that just made the change (`revoked_reason = 'password_changed'`).
- Independent multi-device management falls out of the shape for free: each
  login is its own row; a future `GET /auth/sessions` / `DELETE
  /auth/sessions/:id` just queries/updates rows scoped to the caller.
- Every issue, rotation, revocation, reuse-detection, and admin revocation
  writes an `audit_logs` row through the existing `AuditService` — no new
  audit mechanism needed.

## Explicitly not decided here

Which phase implements this. It's approved and specified; scheduling it is
a separate call.
