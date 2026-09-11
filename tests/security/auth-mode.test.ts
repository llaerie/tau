import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAuthMode, isFullAuthMode } from "@/lib/security/auth-mode";
import { createUser, removeUser, resetUsersCache } from "@/lib/security/users";
import { createSessionToken, isLabMode, resolveActor, LAB_DEFAULT_ACTOR, serializeSessionCookie } from "@/lib/security/session";
import { authenticateSessionToken, authenticateFullModeToken, actorForUser, loginCookieFor, logoutCookie } from "@/lib/security/auth";
import { loginRateLimitStatus, recordLoginFailure, clearLoginFailures, resetLoginRateLimits, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from "@/lib/security/login-rate-limit";
import { ControlViolationError } from "@/lib/core/errors";

const PASS = "a sufficiently long password";
const ENV = ["TAU_AUTH_MODE", "TAU_USERS_FILE", "TAU_SESSION_SECRET"] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
let dir: string;
let n = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tau-auth-"));
  for (const k of ENV) saved[k] = process.env[k];
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  delete process.env.TAU_AUTH_MODE;
  process.env.TAU_USERS_FILE = join(dir, `users-${n++}.json`);
  process.env.TAU_SESSION_SECRET = "unit-test-session-secret-for-auth-mode";
  resetUsersCache();
  resetLoginRateLimits();
});
afterEach(() => resetUsersCache());

describe("auth mode resolution", () => {
  it("defaults to lab without a users file and flips to full once a user exists", () => {
    expect(resolveAuthMode()).toBe("lab");
    expect(isLabMode()).toBe(true);
    expect(isFullAuthMode()).toBe(false);
    createUser({ email: "o@example.com", displayName: "O", role: "OWNER", password: PASS });
    expect(resolveAuthMode()).toBe("full");
    expect(isLabMode()).toBe(false);
    removeUser("o@example.com");
    expect(resolveAuthMode()).toBe("lab");
  });

  it("TAU_AUTH_MODE wins in both directions", () => {
    process.env.TAU_AUTH_MODE = "full";
    expect(resolveAuthMode()).toBe("full");
    createUser({ email: "o@example.com", displayName: "O", role: "OWNER", password: PASS });
    process.env.TAU_AUTH_MODE = "lab";
    expect(resolveAuthMode()).toBe("lab");
    process.env.TAU_AUTH_MODE = "FULL";
    expect(resolveAuthMode()).toBe("full");
    process.env.TAU_AUTH_MODE = "nonsense";
    expect(resolveAuthMode()).toBe("full"); // falls through to "users exist"
  });
});

describe("session authentication", () => {
  it("lab mode: missing or forged cookies resolve to the default owner", () => {
    expect(resolveAuthMode()).toBe("lab");
    expect(authenticateSessionToken(undefined)).toEqual(LAB_DEFAULT_ACTOR);
    expect(authenticateSessionToken("forged.token")).toEqual(LAB_DEFAULT_ACTOR);
  });

  it("full mode: missing, forged, foreign-secret and unknown-user tokens are rejected; nothing falls back to the lab actor", () => {
    const user = createUser({ email: "op@example.com", displayName: "Op", role: "FINANCE_OPERATOR", password: PASS });
    expect(resolveAuthMode()).toBe("full");
    expect(() => authenticateSessionToken(undefined)).toThrow(ControlViolationError);
    expect(() => authenticateSessionToken("")).toThrow(ControlViolationError);
    expect(() => authenticateSessionToken("forged.token")).toThrow(ControlViolationError);
    expect(() => resolveActor(undefined)).toThrow(ControlViolationError);

    const good = createSessionToken(actorForUser(user));
    expect(authenticateSessionToken(good)).toEqual({ type: "USER", id: user.id, role: "FINANCE_OPERATOR", displayName: "Op" });

    // Signed with another secret: invalid.
    process.env.TAU_SESSION_SECRET = "someone-elses-secret-value-here";
    const foreign = createSessionToken(actorForUser(user));
    process.env.TAU_SESSION_SECRET = "unit-test-session-secret-for-auth-mode";
    expect(() => authenticateFullModeToken(foreign)).toThrow(ControlViolationError);

    // Validly signed but for an actor that is not in the directory (e.g. the lab owner): rejected.
    const labOwner = createSessionToken({ ...LAB_DEFAULT_ACTOR });
    expect(() => authenticateFullModeToken(labOwner)).toThrow(/known user/);

    // Role in the cookie cannot escalate: the directory is authoritative.
    const escalated = createSessionToken({ type: "USER", id: user.id, role: "OWNER", displayName: "Op" });
    expect(authenticateFullModeToken(escalated).role).toBe("FINANCE_OPERATOR");

    // Removed user: cookie stops working immediately.
    removeUser("op@example.com");
    process.env.TAU_AUTH_MODE = "full";
    expect(() => authenticateFullModeToken(good)).toThrow(ControlViolationError);
  });

  it("expired tokens are rejected in full mode", () => {
    const user = createUser({ email: "x@example.com", displayName: "X", role: "OWNER", password: PASS });
    const token = createSessionToken(actorForUser(user), { ttlSeconds: 10, now: () => 1_000_000 });
    expect(authenticateSessionToken(token, { now: () => 1_005_000 }).id).toBe(user.id);
    expect(() => authenticateSessionToken(token, { now: () => 1_020_000 })).toThrow(/EXPIRED/);
  });

  it("login/logout cookies are HttpOnly, SameSite=Strict and the logout cookie expires immediately", () => {
    const user = createUser({ email: "c@example.com", displayName: "C", role: "VIEWER", password: PASS });
    const cookie = loginCookieFor(user);
    expect(cookie).toMatch(/^tau_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(serializeSessionCookie("t")).toContain("Path=/");
    expect(logoutCookie()).toContain("Max-Age=0");
  });
});

describe("login throttle", () => {
  it("blocks after 5 failures within 15 minutes and recovers after the window", () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) recordLoginFailure("a@example.com", t0 + i * 1000);
    expect(loginRateLimitStatus("a@example.com", t0 + 5000).blocked).toBe(false);
    const st = recordLoginFailure("A@example.com", t0 + 6000);
    expect(st.blocked).toBe(true);
    expect(st.failures).toBe(LOGIN_MAX_FAILURES);
    expect(loginRateLimitStatus("a@example.com", t0 + 60_000).retryAfterMs).toBeGreaterThan(0);
    expect(loginRateLimitStatus("b@example.com", t0 + 60_000).blocked).toBe(false);
    expect(loginRateLimitStatus("a@example.com", t0 + LOGIN_WINDOW_MS + 1).blocked).toBe(false);
    recordLoginFailure("a@example.com", t0);
    clearLoginFailures("a@example.com");
    expect(loginRateLimitStatus("a@example.com", t0 + 1).failures).toBe(0);
  });
});
