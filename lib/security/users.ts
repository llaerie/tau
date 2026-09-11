/**
 * Local user directory for full auth mode.
 *
 * Users live in a JSON file (default `.tau/users.json`, gitignored; override with
 * `TAU_USERS_FILE`). They are deliberately NOT part of `CompanyDataset` — identity is
 * infrastructure, not company data, and must never ship inside a snapshot or export.
 *
 * Passwords are hashed with scrypt (N=16384, r=8, p=1, 64-byte key) under a per-user
 * random salt and compared with `timingSafeEqual`. Nothing in this module logs, throws
 * or returns a password, salt or hash to callers outside the file itself.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Role } from "@/lib/core/types";
import { TauError } from "@/lib/core/errors";

export const USER_ROLES: readonly Role[] = Object.freeze(["OWNER", "FINANCE_OPERATOR", "CPA", "VIEWER"]);
export type UserRole = (typeof USER_ROLES)[number];

export const MIN_PASSWORD_LENGTH = 12;
/** Upper bound so a hostile client cannot make scrypt chew on megabytes. */
export const MAX_PASSWORD_LENGTH = 512;

const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

/** What callers outside this module see: never the hash or salt. */
export type PublicUser = Omit<UserRecord, "passwordHash" | "salt">;

interface UsersFile {
  version: 1;
  users: UserRecord[];
}

export function usersFilePath(): string {
  const override = process.env.TAU_USERS_FILE;
  return override && override.trim() !== "" ? resolve(override) : resolve(process.cwd(), ".tau", "users.json");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function isUserRole(role: unknown): role is UserRole {
  return typeof role === "string" && (USER_ROLES as readonly string[]).includes(role);
}

const toPublic = (u: UserRecord): PublicUser => ({ id: u.id, email: u.email, displayName: u.displayName, role: u.role, createdAt: u.createdAt });

// ---------------------------------------------------------------------------
// File access (tiny mtime cache so per-request mode checks do not re-parse)
// ---------------------------------------------------------------------------

let cache: { path: string; mtimeMs: number; size: number; users: UserRecord[] } | null = null;

function isUserRecord(v: unknown): v is UserRecord {
  if (!v || typeof v !== "object") return false;
  const u = v as Record<string, unknown>;
  return typeof u.id === "string" && typeof u.email === "string" && typeof u.displayName === "string" && isUserRole(u.role) && typeof u.passwordHash === "string" && typeof u.salt === "string" && typeof u.createdAt === "string";
}

function readUsers(): UserRecord[] {
  const path = usersFilePath();
  if (!existsSync(path)) {
    cache = null;
    return [];
  }
  const st = statSync(path);
  if (cache && cache.path === path && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.users;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new TauError("INVALID_STATE", `Users file at ${path} is not valid JSON`);
  }
  const raw = parsed && typeof parsed === "object" && Array.isArray((parsed as UsersFile).users) ? (parsed as UsersFile).users : [];
  const users = raw.filter(isUserRecord);
  cache = { path, mtimeMs: st.mtimeMs, size: st.size, users };
  return users;
}

function writeUsers(users: UserRecord[]): void {
  const path = usersFilePath();
  mkdirSync(dirname(path), { recursive: true });
  const body: UsersFile = { version: 1, users };
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  cache = null;
}

/** Drop the in-process cache (tests that swap TAU_USERS_FILE call this). */
export function resetUsersCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function hashPassword(password: string, saltHex: string): Buffer {
  return scryptSync(password, Buffer.from(saltHex, "hex"), KEY_LENGTH, SCRYPT_PARAMS);
}

/** Constant-time comparison of a candidate password against a stored salt/hash pair. */
export function verifyPasswordHash(password: string, saltHex: string, hashHex: string): boolean {
  const expected = Buffer.from(hashHex, "hex");
  const actual = hashPassword(password, saltHex);
  if (expected.length !== actual.length) {
    // Still burn a compare so the caller's timing does not depend on the stored value's shape.
    timingSafeEqual(actual, actual);
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/** Salt/hash used when the email is unknown so a login attempt costs the same either way. */
const DUMMY_SALT = "00000000000000000000000000000000";
const DUMMY_HASH = hashPassword("tau-dummy-password-not-a-secret", DUMMY_SALT).toString("hex");

function assertPasswordPolicy(password: unknown): asserts password is string {
  if (typeof password !== "string") throw new TauError("BAD_REQUEST", "Password must be a string");
  if (password.length < MIN_PASSWORD_LENGTH) throw new TauError("BAD_REQUEST", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (password.length > MAX_PASSWORD_LENGTH) throw new TauError("BAD_REQUEST", `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listUsers(): PublicUser[] {
  return readUsers().map(toPublic);
}

export function hasUsers(): boolean {
  return readUsers().length > 0;
}

export function findUserByEmail(email: string): PublicUser | null {
  const norm = normalizeEmail(email);
  const u = readUsers().find((x) => x.email === norm);
  return u ? toPublic(u) : null;
}

export function findUserById(id: string): PublicUser | null {
  const u = readUsers().find((x) => x.id === id);
  return u ? toPublic(u) : null;
}

export function createUser(input: { email: string; displayName: string; role: string; password: string }): PublicUser {
  const email = normalizeEmail(String(input.email ?? ""));
  if (!isValidEmail(email)) throw new TauError("BAD_REQUEST", "A valid email address is required");
  const displayName = String(input.displayName ?? "").trim();
  if (!displayName) throw new TauError("BAD_REQUEST", "displayName is required");
  if (!isUserRole(input.role)) throw new TauError("BAD_REQUEST", `role must be one of ${USER_ROLES.join(", ")}`);
  assertPasswordPolicy(input.password);
  const users = readUsers();
  if (users.some((u) => u.email === email)) throw new TauError("INVALID_STATE", `A user with email ${email} already exists`);
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const record: UserRecord = {
    id: `usr_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    email,
    displayName,
    role: input.role,
    passwordHash: hashPassword(input.password, salt).toString("hex"),
    salt,
    createdAt: new Date().toISOString(),
  };
  writeUsers([...users, record]);
  return toPublic(record);
}

/**
 * Verify a password. Returns the public user on success, null otherwise. Unknown emails
 * still pay for one scrypt derivation so response time does not reveal whether an
 * account exists.
 */
export function verifyPassword(email: string, password: string): PublicUser | null {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return null;
  const norm = normalizeEmail(String(email ?? ""));
  const user = readUsers().find((u) => u.email === norm);
  if (!user) {
    verifyPasswordHash(password, DUMMY_SALT, DUMMY_HASH);
    return null;
  }
  return verifyPasswordHash(password, user.salt, user.passwordHash) ? toPublic(user) : null;
}

export function setPassword(email: string, newPassword: string): PublicUser {
  assertPasswordPolicy(newPassword);
  const norm = normalizeEmail(email);
  const users = readUsers();
  const idx = users.findIndex((u) => u.email === norm);
  if (idx < 0) throw new TauError("NOT_FOUND", "User not found");
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const updated: UserRecord = { ...users[idx], salt, passwordHash: hashPassword(newPassword, salt).toString("hex") };
  const next = [...users];
  next[idx] = updated;
  writeUsers(next);
  return toPublic(updated);
}

export function removeUser(email: string): boolean {
  const norm = normalizeEmail(email);
  const users = readUsers();
  const next = users.filter((u) => u.email !== norm);
  if (next.length === users.length) return false;
  writeUsers(next);
  return true;
}
