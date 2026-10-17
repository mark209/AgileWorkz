// Shared between apps/api, apps/web, apps/field.
// Kept intentionally small in Phase 1 — grows as each later phase lands its own domain.

// Plain string-literal unions, not TS enums — Prisma generates its own real
// enums with these exact values for the API side, and a `enum` here would be
// a second, nominally-distinct type with the same members, which doesn't
// structurally match Prisma's even when every value is identical. The
// frontend (which has no Prisma client) only needs the shape, not a
// competing enum.
export type UserStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";
export type ActorType = "USER" | "SYSTEM" | "WORKER" | "INTEGRATION";
export type SettingValueType = "NUMBER" | "STRING" | "BOOL";

// Default V1 role names (seeded, but roles remain data — this is a convenience
// list for the frontend, not a source of truth the backend trusts).
export const DEFAULT_ROLE_NAMES = [
  "Admin/Owner",
  "Manager",
  "Office Staff",
  "Technician",
] as const;
export type DefaultRoleName = (typeof DEFAULT_ROLE_NAMES)[number];

export interface RequestableDesignation { id: string; name: string }

export interface RegistrationRequestInput {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  requestedRoleId: string;
}

export interface RegistrationResponse { message: string }

export interface PermissionRef {
  module: string;
  action: string;
}

export interface AuthenticatedUser {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  roles: string[];
  permissions: PermissionRef[];
}

export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface LoginResponseDto {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
}

export interface SystemSettingDto {
  key: string;
  value: string;
  valueType: SettingValueType;
  description?: string | null;
  updatedBy?: string | null;
  updatedAt: string;
}

export interface AuditLogEntryDto {
  id: string;
  actorType: ActorType;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  reason?: string | null;
  createdAt: string;
}

// Well-known Phase-1 system_settings keys. Values live in the DB, not here —
// this just gives the frontend typed keys to reference.
export const SYSTEM_SETTING_KEYS = {
  QUOTATION_APPROVAL_THRESHOLD_PHP: "quotation_approval_threshold_php",
  QUOTATION_DISCOUNT_THRESHOLD_PCT: "quotation_discount_threshold_pct",
  DOCUMENT_RETENTION_YEARS: "document_retention_years",
} as const;
