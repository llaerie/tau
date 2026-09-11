import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Wrap node:crypto so the timing-safe comparison path is observable.
const timingSafeCalls = vi.fn();
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      timingSafeCalls(a.byteLength, b.byteLength);
      return real.timingSafeEqual(a, b);
    },
  };
});

import { createUser, findUserByEmail, findUserById, listUsers, removeUser, resetUsersCache, setPassword, verifyPassword, verifyPasswordHash, usersFilePath, hasUsers, MIN_PASSWORD_LENGTH, USER_ROLES } from "@/lib/security/users";
import { TauError } from "@/lib/core/errors";

const PASS = "correct horse battery staple";
let dir: string;
const savedFile = process.env.TAU_USERS_FILE;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tau-users-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  if (savedFile === undefined) delete process.env.TAU_USERS_FILE;
  else process.env.TAU_USERS_FILE = savedFile;
});

let n = 0;
beforeEach(() => {
  process.env.TAU_USERS_FILE = join(dir, `users-${n++}.json`);
  resetUsersCache();
  timingSafeCalls.mockClear();
});
afterEach(() => resetUsersCache());

describe("users directory", () => {
  it("honours TAU_USERS_FILE and starts empty", () => {
    expect(usersFilePath()).toBe(process.env.TAU_USERS_FILE);
    expect(listUsers()).toEqual([]);
    expect(hasUsers()).toBe(false);
  });

  it("creates a user with a per-user salt and a scrypt hash, never exposing either", () => {
    const u = createUser({ email: "  Owner@Example.COM ", displayName: "Owner", role: "OWNER", password: PASS });
    expect(u.email).toBe("owner@example.com");
    expect(u.role).toBe("OWNER");
    expect(u.id).toMatch(/^usr_/);
    expect(Object.keys(u).sort()).toEqual(["createdAt", "displayName", "email", "id", "role"]);
    expect(hasUsers()).toBe(true);
    expect(findUserByEmail("OWNER@example.com")).toEqual(u);
    expect(findUserById(u.id)).toEqual(u);

    const raw = JSON.parse(readFileSync(usersFilePath(), "utf8")) as { users: { salt: string; passwordHash: string }[] };
    expect(raw.users).toHaveLength(1);
    expect(raw.users[0].salt).toMatch(/^[0-9a-f]{32}$/);
    expect(raw.users[0].passwordHash).toMatch(/^[0-9a-f]{128}$/);
    expect(raw.users[0].passwordHash).not.toContain(PASS);
    expect(readFileSync(usersFilePath(), "utf8")).not.toContain(PASS);
    if (process.platform !== "win32") expect(statSync(usersFilePath()).mode & 0o777).toBe(0o600);

    const second = createUser({ email: "op@example.com", displayName: "Op", role: "FINANCE_OPERATOR", password: PASS });
    const raw2 = JSON.parse(readFileSync(usersFilePath(), "utf8")) as { users: { email: string; salt: string; passwordHash: string }[] };
    const a = raw2.users.find((x) => x.email === u.email)!;
    const b = raw2.users.find((x) => x.email === second.email)!;
    expect(a.salt).not.toBe(b.salt);
    expect(a.passwordHash).not.toBe(b.passwordHash); // same password, different salt
  });

  it("verifies passwords and rejects wrong ones", () => {
    const u = createUser({ email: "a@example.com", displayName: "A", role: "CPA", password: PASS });
    expect(verifyPassword("a@example.com", PASS)).toEqual(u);
    expect(verifyPassword("A@EXAMPLE.com", PASS)).toEqual(u);
    expect(verifyPassword("a@example.com", `${PASS}x`)).toBeNull();
    expect(verifyPassword("a@example.com", "")).toBeNull();
    expect(verifyPassword("nobody@example.com", PASS)).toBeNull();
  });

  it("uses timingSafeEqual for every comparison, including unknown emails (no early exit)", () => {
    createUser({ email: "a@example.com", displayName: "A", role: "VIEWER", password: PASS });
    timingSafeCalls.mockClear();
    verifyPassword("a@example.com", PASS);
    expect(timingSafeCalls).toHaveBeenCalledTimes(1);
    expect(timingSafeCalls).toHaveBeenLastCalledWith(64, 64);
    verifyPassword("a@example.com", "wrong password here");
    expect(timingSafeCalls).toHaveBeenCalledTimes(2);
    verifyPassword("ghost@example.com", "wrong password here");
    expect(timingSafeCalls).toHaveBeenCalledTimes(3);
  });

  it("verifyPasswordHash never throws on a malformed stored hash and still compares", () => {
    const raw = JSON.parse(readFileSync((createUser({ email: "h@example.com", displayName: "H", role: "VIEWER", password: PASS }), usersFilePath()), "utf8")) as { users: { salt: string; passwordHash: string }[] };
    const { salt, passwordHash } = raw.users[0];
    expect(verifyPasswordHash(PASS, salt, passwordHash)).toBe(true);
    expect(verifyPasswordHash(PASS, salt, passwordHash.slice(0, 20))).toBe(false);
    timingSafeCalls.mockClear();
    expect(verifyPasswordHash(PASS, salt, "")).toBe(false);
    expect(timingSafeCalls).toHaveBeenCalledTimes(1);
    const flipped = (passwordHash[0] === "0" ? "1" : "0") + passwordHash.slice(1);
    expect(verifyPasswordHash(PASS, salt, flipped)).toBe(false);
  });

  it("rejects duplicates (case-insensitively), short passwords, bad roles and bad emails", () => {
    createUser({ email: "dup@example.com", displayName: "Dup", role: "OWNER", password: PASS });
    expect(() => createUser({ email: "DUP@example.com", displayName: "Dup 2", role: "OWNER", password: PASS })).toThrow(/already exists/);
    expect(() => createUser({ email: "short@example.com", displayName: "S", role: "OWNER", password: "x".repeat(MIN_PASSWORD_LENGTH - 1) })).toThrow(TauError);
    expect(() => createUser({ email: "short@example.com", displayName: "S", role: "OWNER", password: "x".repeat(MIN_PASSWORD_LENGTH - 1) })).toThrow(/at least 12/);
    expect(() => createUser({ email: "role@example.com", displayName: "R", role: "AGENT", password: PASS })).toThrow(/role must be one of/);
    expect(() => createUser({ email: "role@example.com", displayName: "R", role: "SYSTEM", password: PASS })).toThrow(TauError);
    expect(() => createUser({ email: "not-an-email", displayName: "R", role: "OWNER", password: PASS })).toThrow(/valid email/);
    expect(() => createUser({ email: "blank@example.com", displayName: "  ", role: "OWNER", password: PASS })).toThrow(/displayName/);
    expect(listUsers()).toHaveLength(1);
    expect([...USER_ROLES]).toEqual(["OWNER", "FINANCE_OPERATOR", "CPA", "VIEWER"]);
  });

  it("setPassword rotates the salt and invalidates the old password; removeUser deletes", () => {
    createUser({ email: "rot@example.com", displayName: "Rot", role: "OWNER", password: PASS });
    const before = (JSON.parse(readFileSync(usersFilePath(), "utf8")) as { users: { salt: string }[] }).users[0].salt;
    const NEW = "another long passphrase 42";
    setPassword("rot@example.com", NEW);
    const after = (JSON.parse(readFileSync(usersFilePath(), "utf8")) as { users: { salt: string }[] }).users[0].salt;
    expect(after).not.toBe(before);
    expect(verifyPassword("rot@example.com", PASS)).toBeNull();
    expect(verifyPassword("rot@example.com", NEW)).not.toBeNull();
    expect(() => setPassword("rot@example.com", "short")).toThrow(/at least 12/);
    expect(() => setPassword("missing@example.com", NEW)).toThrow(/not found/);
    expect(removeUser("ROT@example.com")).toBe(true);
    expect(removeUser("rot@example.com")).toBe(false);
    expect(hasUsers()).toBe(false);
  });
});
