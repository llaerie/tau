import { describe, expect, it } from "vitest";
import { ApprovalRequiredError, ControlViolationError, PeriodLockedError } from "@/lib/core/errors";
import { periodTags } from "@/lib/accounting/periods";
import { acct, actor, makeLedger, owner } from "./fixture";

const simple = (date: string, debit: string, credit: string, amount = "100", source: "MANUAL" | "ADJUSTING" | "AGENT" = "MANUAL") => ({
  date,
  description: `${debit}/${credit}`,
  source,
  lines: [{ accountCode: debit, debit: amount }, { accountCode: credit, credit: amount }],
});

describe("Period lifecycle and locking", () => {
  it("locks with an approval and then rejects creating, posting and reversing into the period", () => {
    const { ledger } = makeLedger();
    ledger.createEntry({ ...simple("2026-02-10", "1000", "3000", "1000"), post: true }, actor);
    const posted = ledger.createEntry({ ...simple("2026-02-12", "7100", "1000", "200"), post: true }, actor);
    const draft = ledger.createEntry(simple("2026-02-20", "7000", "1000", "50"), actor);

    const p = ledger.lockPeriod("2026-02", owner, "appr_lock");
    expect(p.status).toBe("LOCKED");
    expect(p.lockedAt).toBeDefined();
    expect(p.lockedBy).toBe(owner.id);
    expect(p.lockApprovalId).toBe("appr_lock");

    expect(() => ledger.createEntry({ ...simple("2026-02-25", "7000", "1000"), post: true }, actor)).toThrow(PeriodLockedError);
    expect(() => ledger.createEntry(simple("2026-02-25", "7000", "1000"), actor)).toThrow(PeriodLockedError);
    expect(() => ledger.createEntry({ ...simple("2026-02-25", "7000", "1000", "10", "ADJUSTING"), post: true }, actor)).toThrow(PeriodLockedError);
    expect(() => ledger.postEntry(draft.id, actor)).toThrow(PeriodLockedError);
    expect(() => ledger.reverseEntry(posted.id, "2026-02-28", actor, "oops")).toThrow(PeriodLockedError);
    // Reversal into the next open period is fine.
    const rev = ledger.reverseEntry(posted.id, "2026-03-01", actor, "reverse in March");
    expect(rev.periodId).toBe("2026-03");
    expect(() => ledger.softClosePeriod("2026-02", actor)).toThrow(PeriodLockedError);
    // Locking again is a no-op and does not change lock metadata.
    const again = ledger.lockPeriod("2026-02", owner, "appr_other");
    expect(again.lockApprovalId).toBe("appr_lock");
  });

  it("requires an approval to lock and rejects a non-APPROVED known approval", () => {
    const { ledger, ds } = makeLedger();
    ledger.ensurePeriod("2026-02-01");
    expect(() => ledger.lockPeriod("2026-02", owner, "")).toThrow(ApprovalRequiredError);
    ds.approvals.push({
      id: "appr_pending",
      action: { id: "act", kind: "LOCK_PERIOD", agent: "USER", description: "", targetIds: [], payload: {}, reason: "", sourceDocumentIds: [], confidence: 1, reversible: true, createdAt: "2026-03-01T00:00:00Z" },
      risk: { actionId: "act", level: "RED", reasons: [], requiredApproverRoles: ["OWNER"], materialityBreached: false, autoExecutable: false, policyRefs: [], assessedAt: "2026-03-01T00:00:00Z" },
      requestedApproverRoles: ["OWNER"],
      status: "PENDING",
      requestedAt: "2026-03-01T00:00:00Z",
      auditEventIds: [],
    });
    expect(() => ledger.lockPeriod("2026-02", owner, "appr_pending")).toThrow(ApprovalRequiredError);
    ds.approvals[0].status = "APPROVED";
    expect(ledger.lockPeriod("2026-02", owner, "appr_pending").status).toBe("LOCKED");
  });

  it("rejects locking while suspense (9999) is non-zero, then locks once cleared", () => {
    const { ledger } = makeLedger();
    ledger.createEntry({ ...simple("2026-02-10", "1000", "3000", "1000"), post: true }, actor);
    ledger.createEntry({ ...simple("2026-02-11", "9999", "1000", "75"), post: true }, actor);
    expect(() => ledger.lockPeriod("2026-02", owner, "appr")).toThrow(ControlViolationError);
    expect(() => ledger.lockPeriod("2026-02", owner, "appr")).toThrow(/suspense/i);
    ledger.createEntry({ ...simple("2026-02-28", "7400", "9999", "75", "ADJUSTING"), post: true }, actor);
    expect(ledger.lockPeriod("2026-02", owner, "appr").status).toBe("LOCKED");
  });

  it("unlock requires approval and reason, records history via tags, and allows posting again", () => {
    const { ledger } = makeLedger();
    ledger.createEntry({ ...simple("2026-02-10", "1000", "3000", "1000"), post: true }, actor);
    ledger.lockPeriod("2026-02", owner, "appr_lock");
    expect(() => ledger.unlockPeriod("2026-02", owner, "", "typo")).toThrow(ApprovalRequiredError);
    expect(() => ledger.unlockPeriod("2026-02", owner, "appr_unlock", "  ")).toThrow(ControlViolationError);
    const p = ledger.unlockPeriod("2026-02", owner, "appr_unlock", "Late vendor bill");
    expect(p.status).toBe("OPEN");
    expect(p.lockedAt).toBeUndefined();
    const tags = periodTags(p);
    expect(tags.some((t) => t.startsWith("locked:") && t.includes("appr_lock"))).toBe(true);
    expect(tags.some((t) => t.startsWith("unlocked:") && t.includes("appr_unlock") && t.endsWith("Late vendor bill"))).toBe(true);
    const e = ledger.createEntry({ ...simple("2026-02-27", "7100", "1000", "40"), post: true }, actor);
    expect(e.status).toBe("POSTED");
    expect(() => ledger.unlockPeriod("2026-02", owner, "appr_unlock", "again")).toThrow(ControlViolationError);
    // Re-lock: the integrity check about post-lock entries stays clean because lockedAt is refreshed.
    ledger.lockPeriod("2026-02", owner, "appr_lock2");
    expect(ledger.runIntegrityChecks("2026-02-28").checks.find((c) => c.key === "locked-period-posting")!.passed).toBe(true);
  });

  it("soft close blocks routine sources but allows adjusting entries", () => {
    const { ledger } = makeLedger();
    ledger.createEntry({ ...simple("2026-02-10", "1000", "3000", "1000"), post: true }, actor);
    const p = ledger.softClosePeriod("2026-02", actor);
    expect(p.status).toBe("SOFT_CLOSED");
    expect(() => ledger.createEntry({ ...simple("2026-02-20", "7000", "1000"), post: true }, actor)).toThrow(PeriodLockedError);
    expect(() => ledger.createEntry({ ...simple("2026-02-20", "7000", "1000", "10", "AGENT") }, actor)).toThrow(PeriodLockedError);
    const adj = ledger.createEntry({ ...simple("2026-02-28", "7200", "2100", "500", "ADJUSTING"), post: true }, actor);
    expect(adj.status).toBe("POSTED");
    const rev = ledger.reverseEntry(adj.id, "2026-02-28", actor, "undo accrual");
    expect(rev.source).toBe("REVERSAL");
  });

  it("integrity reports entries whose postedAt is after the period lock", () => {
    const { ledger, ds } = makeLedger();
    const e = ledger.createEntry({ ...simple("2026-02-10", "1000", "3000", "1000"), post: true }, actor);
    ledger.lockPeriod("2026-02", owner, "appr");
    // Simulate tampering: the entry claims to have been posted after the lock timestamp.
    ds.journalEntries.find((x) => x.id === e.id)!.postedAt = "2999-01-01T00:00:00.000Z";
    const check = ledger.runIntegrityChecks("2026-02-28").checks.find((c) => c.key === "locked-period-posting")!;
    expect(check.passed).toBe(false);
    expect(check.severity).toBe("ERROR");
    expect(ledger.accountBalance(acct("1000"), "2026-02-28")).toBe("1000.0000");
  });
});
