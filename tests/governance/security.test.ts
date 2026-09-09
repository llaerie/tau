import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { can, requirePermission, permissionsFor, ROLES, PERMISSIONS, approverRolesFor } from "@/lib/security/rbac";
import { redactForRole, redactForModel, REDACTED, maskIdentifierPatterns } from "@/lib/security/redaction";
import { assertNoSecretsInText, containsSecret, findSecretInText, getSecret, requireSecret, scrubSecrets } from "@/lib/security/secrets";
import { createSessionToken, verifySessionToken, resolveActor, LAB_DEFAULT_ACTOR, parseCookieHeader, serializeSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session";
import { PermissionDeniedError, ControlViolationError } from "@/lib/core/errors";
import type { PayrollRun, Worker } from "@/lib/core/types";
import { OWNER, VIEWER, AGENT, CPA, OPERATOR } from "./helpers";

describe("RBAC", () => {
  it("VIEW_HOUSEHOLD is never granted to any role", () => {
    for (const r of ROLES) {
      expect(can(r, "VIEW_HOUSEHOLD")).toBe(false);
      expect(permissionsFor(r)).not.toContain("VIEW_HOUSEHOLD");
    }
    expect(() => requirePermission(OWNER, "VIEW_HOUSEHOLD")).toThrow(PermissionDeniedError);
  });

  it("owner holds every business permission; viewer only views financials", () => {
    for (const p of PERMISSIONS) if (p !== "VIEW_HOUSEHOLD") expect(can("OWNER", p)).toBe(true);
    expect(permissionsFor("VIEWER")).toEqual(["VIEW_FINANCIALS"]);
  });

  it("agents and system can never approve", () => {
    for (const r of ["AGENT", "SYSTEM", "VIEWER", "AUDITOR"] as const) {
      expect(can(r, "APPROVE_YELLOW")).toBe(false);
      expect(can(r, "APPROVE_RED")).toBe(false);
    }
    expect(approverRolesFor("YELLOW").sort()).toEqual(["FINANCE_OPERATOR", "OWNER"]);
    expect(approverRolesFor("RED").sort()).toEqual(["ATTORNEY", "CPA", "OWNER", "PAYROLL_PROFESSIONAL"]);
    expect(approverRolesFor("GREEN")).toEqual([]);
  });

  it("requirePermission throws with details", () => {
    expect(() => requirePermission(VIEWER, "LOCK_PERIOD")).toThrow(PermissionDeniedError);
    expect(() => requirePermission(OPERATOR, "LOCK_PERIOD")).not.toThrow();
    try {
      requirePermission(AGENT, "APPROVE_RED");
    } catch (e) {
      expect((e as PermissionDeniedError).details).toMatchObject({ role: "AGENT", permission: "APPROVE_RED" });
    }
  });
});

const run: PayrollRun = {
  id: "pr_1",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  payDate: "2026-09-01",
  currency: "USD",
  status: "PAID",
  lines: [
    { workerId: "w_1", gross: "8000.0000", federalIncomeTaxWithheld: "1200.0000", stateIncomeTaxWithheld: "400.0000", socialSecurityEmployee: "496.0000", medicareEmployee: "116.0000", stateDisabilityEmployee: "72.0000", otherDeductions: "0.0000", netPay: "5716.0000", socialSecurityEmployer: "496.0000", medicareEmployer: "116.0000", federalUnemploymentEmployer: "0.0000", stateUnemploymentEmployer: "0.0000", stateTrainingTaxEmployer: "0.0000", otherEmployerCosts: "0.0000", totalEmployerCost: "8612.0000" },
  ],
  totals: { gross: "8000.0000", employeeTaxes: "2284.0000", otherDeductions: "0.0000", netPay: "5716.0000", employerTaxes: "612.0000", totalEmployerCost: "8612.0000" },
  netPayTransactionIds: ["tx_1"],
};

const worker: Worker = {
  id: "w_1",
  displayName: "Sam",
  roleTitle: "Engineer",
  country: "US",
  workerType: "EMPLOYEE",
  classificationStatus: "CONFIRMED",
  compensation: { type: "SALARY", amount: "96000.0000", currency: "USD", period: "ANNUAL", basis: "GROSS", status: "CONFIRMED" },
  startDate: "2025-01-01",
  isOwner: false,
  relatedParty: false,
  documentIds: [],
  isSynthetic: true,
};

describe("redaction", () => {
  it("strips per-worker payroll amounts for roles without VIEW_PAYROLL_DETAIL but keeps totals", () => {
    const red = redactForRole(run, "FINANCE_OPERATOR");
    expect(red.lines[0].gross).toBe(REDACTED);
    expect(red.lines[0].netPay).toBe(REDACTED);
    expect(red.lines[0].workerId).toBe("w_1");
    expect(red.totals.gross).toBe("8000.0000");
    expect(run.lines[0].gross).toBe("8000.0000"); // input untouched
    const w = redactForRole(worker, "VIEWER");
    expect(w.compensation.amount).toBe(REDACTED);
    expect(w.compensation.basis).toBe("GROSS");
  });

  it("keeps payroll detail for owner, CPA and payroll professional", () => {
    for (const r of ["OWNER", "CPA", "PAYROLL_PROFESSIONAL", "AUDITOR"] as const) expect(redactForRole(run, r).lines[0].gross).toBe("8000.0000");
    expect(redactForRole(run, "OWNER")).not.toBe(run);
  });

  it("masks last4 / EIN-like fields and EIN/SSN-shaped values for roles without VIEW_SENSITIVE_IDENTIFIERS", () => {
    const bank = { id: "b_1", name: "Ops Checking", last4: "4321", ein: "12-3456789", accountNumber: "000123456789", note: "EIN 98-7654321 and SSN 123-45-6789 appear here" };
    const red = redactForRole(bank, "AGENT");
    expect(red.last4).toBe("••••");
    expect(red.ein).toBe("••••••6789");
    expect(red.accountNumber).toBe("••••••••6789");
    expect(red.note).toBe("EIN ••-••••••• and SSN •••-••-•••• appear here");
    expect(redactForRole(bank, "OWNER").ein).toBe("12-3456789");
    expect(redactForRole(bank, CPA.role).last4).toBe("4321");
    expect(redactForModel(bank).ein).toBe("••••••6789");
    expect(maskIdentifierPatterns("no ids here")).toBe("no ids here");
  });
});

describe("secrets guard", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ["ANTHROPIC_API_KEY", "TAU_TEST_SECRET"]) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it.each([
    ["anthropic key", "please use sk-ant-api03-abcdefghijklmnop"],
    ["openai style key", "token sk-abcdefghijklmnopqrstuvwxyz123456"],
    ["aws access key", "AKIAIOSFODNN7EXAMPLE"],
    ["pem block", "-----BEGIN RSA PRIVATE KEY-----\nMIIE..."],
    ["github token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["postgres url with password", "postgresql://tau:hunter2@db:5432/tau"],
  ])("throws on %s", (_l, text) => {
    expect(containsSecret(text)).toBe(true);
    expect(() => assertNoSecretsInText(text, "prompt")).toThrow(ControlViolationError);
    try {
      assertNoSecretsInText(text);
    } catch (e) {
      expect((e as ControlViolationError).details).toMatchObject({ kind: "SECRET_LEAK" });
    }
  });

  it("passes ordinary financial text", () => {
    const text = "Net income for August was $12,345.67; AR aging shows invoice INV-1042 at 45 days. Risk skew is fine. Task sk-1 done.";
    expect(findSecretInText(text)).toBeNull();
    expect(() => assertNoSecretsInText(text)).not.toThrow();
  });

  it("detects configured secret values from the environment", () => {
    process.env.ANTHROPIC_API_KEY = "zzz-not-a-pattern-value-12345";
    expect(findSecretInText("the key is zzz-not-a-pattern-value-12345")).toBe("env:ANTHROPIC_API_KEY");
    expect(scrubSecrets("the key is zzz-not-a-pattern-value-12345 and sk-ant-abcdefghijklmnop")).toBe("the key is [env:ANTHROPIC_API_KEY] and [anthropic-api-key]");
  });

  it("getSecret reads env only; requireSecret throws when missing", () => {
    delete process.env.TAU_TEST_SECRET;
    expect(getSecret("TAU_TEST_SECRET")).toBeUndefined();
    expect(() => requireSecret("TAU_TEST_SECRET")).toThrow(ControlViolationError);
    process.env.TAU_TEST_SECRET = "abc";
    expect(getSecret("TAU_TEST_SECRET")).toBe("abc");
  });
});

describe("sessions", () => {
  const savedSecret = process.env.TAU_SESSION_SECRET;
  const savedMode = process.env.TAU_AUTH_MODE;
  beforeEach(() => {
    process.env.TAU_SESSION_SECRET = "unit-test-session-secret";
    process.env.TAU_AUTH_MODE = "lab";
  });
  afterEach(() => {
    if (savedSecret === undefined) delete process.env.TAU_SESSION_SECRET;
    else process.env.TAU_SESSION_SECRET = savedSecret;
    if (savedMode === undefined) delete process.env.TAU_AUTH_MODE;
    else process.env.TAU_AUTH_MODE = savedMode;
  });

  it("round-trips a signed token", () => {
    const now = () => Date.parse("2026-09-09T12:00:00Z");
    const token = createSessionToken(CPA, { now, ttlSeconds: 60 });
    const v = verifySessionToken(token, { now });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.payload.actor).toEqual({ type: "USER", id: "u_cpa", role: "CPA", displayName: undefined });
    expect(resolveActor(token, { now }).role).toBe("CPA");
  });

  it("rejects tampered, forged and expired tokens", () => {
    const now = () => Date.parse("2026-09-09T12:00:00Z");
    const token = createSessionToken(VIEWER, { now, ttlSeconds: 60 });
    const [body, sig] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ actor: { ...VIEWER, role: "OWNER" }, iat: 0, exp: 9999999999 })).toString("base64url");
    expect(verifySessionToken(`${forgedBody}.${sig}`, { now })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifySessionToken(`${body}.${sig.slice(0, -2)}xx`, { now })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifySessionToken("garbage", { now })).toEqual({ ok: false, reason: "MALFORMED" });
    expect(verifySessionToken(token, { now: () => now() + 61_000 })).toEqual({ ok: false, reason: "EXPIRED" });
    process.env.TAU_SESSION_SECRET = "a-different-secret";
    expect(verifySessionToken(token, { now })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("lab mode defaults to the OWNER actor when no token is present; full mode does not", () => {
    expect(resolveActor(undefined)).toEqual(LAB_DEFAULT_ACTOR);
    process.env.TAU_AUTH_MODE = "full";
    expect(() => resolveActor(undefined)).toThrow(ControlViolationError);
    expect(() => resolveActor("bad.token")).toThrow(ControlViolationError);
  });

  it("cookie helpers", () => {
    const token = createSessionToken(OWNER);
    const cookie = serializeSessionCookie(token, { secure: false });
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(parseCookieHeader(`a=1; ${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`)[SESSION_COOKIE_NAME]).toBe(token);
  });
});
