import { describe, expect, it } from "vitest";
import { CLOSE_STEPS, independentRecomputation, isBlockingException, runMonthEndClose } from "@/lib/workflows";
import { IDS, OWNER, approvedLockApproval, makeFixtureRuntime } from "./fixture";

const PERIOD = "2026-08";

describe("month-end close", () => {
  it("runs all 21 steps in order and records an audit event with before/after period status", async () => {
    const rt = await makeFixtureRuntime({ includeSuspense: false });
    const result = await runMonthEndClose(rt, PERIOD, OWNER);
    expect(result.steps).toHaveLength(21);
    expect(result.steps.map((s) => s.step)).toEqual(CLOSE_STEPS.map((s) => s.step));
    expect(result.steps.map((s) => s.key)).toEqual(CLOSE_STEPS.map((s) => s.key));
    for (const s of result.steps) {
      expect(["PASSED", "WARNING", "FAILED", "SKIPPED", "NEEDS_APPROVAL"]).toContain(s.status);
      expect(Array.isArray(s.details)).toBe(true);
      expect(Array.isArray(s.exceptions)).toBe(true);
      expect(Array.isArray(s.calcIds)).toBe(true);
    }
    expect(result.statements?.balanceSheet.balanced).toBe(true);
    expect(result.statements?.cashFlowStatement.reconciled).toBe(true);
    expect(result.managementReport?.periodId).toBe(PERIOD);
    expect(result.managementReport?.ratios.grossMargin.calcId).toMatch(/^calc_/);
    expect(result.cpaPackageId).toMatch(/^cpapkg_/);
    expect(result.checklist).toBe(result.steps);
    const ev = rt.dataset.auditEvents.find((e) => e.id === result.auditEventId);
    expect(ev?.eventType).toBe("MONTH_END_CLOSE_RUN");
    expect(ev?.beforeState).toMatchObject({ periodId: PERIOD, status: "OPEN" });
    expect(ev?.afterState).toMatchObject({ periodId: PERIOD, status: "OPEN", locked: false });
    expect(ev?.calculationIds.length).toBeGreaterThan(0);
    expect(rt.audit.verifyChain().valid).toBe(true);
    // Step 19 is skipped when no lock is requested; step 18 is clean on the suspense-free fixture.
    expect(result.steps[18].status).toBe("SKIPPED");
    expect(result.passed).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("creates DRAFT entries (depreciation, prepaid amortization) and never posts them; re-runs do not duplicate", async () => {
    const rt = await makeFixtureRuntime({ includeSuspense: false });
    const postedBefore = rt.dataset.journalEntries.filter((e) => e.status === "POSTED").length;
    const result = await runMonthEndClose(rt, PERIOD, OWNER);
    expect(result.draftedEntryIds.length).toBeGreaterThanOrEqual(2);
    const drafts = result.draftedEntryIds.map((id) => rt.dataset.journalEntries.find((e) => e.id === id)!);
    expect(drafts.every((e) => e && e.status === "DRAFT")).toBe(true);
    expect(drafts.some((e) => e.source === "DEPRECIATION" && e.lines.some((l) => l.accountId === "acct_7700"))).toBe(true);
    expect(drafts.some((e) => (e.tags ?? []).includes("prepaid-amortization") && e.lines.some((l) => l.accountId === "acct_1200" && l.credit === "100.0000"))).toBe(true);
    expect(drafts.every((e) => e.createdBy === OWNER.id && (e.tags ?? []).includes("ai-drafted"))).toBe(true);
    expect(rt.dataset.journalEntries.filter((e) => e.status === "POSTED").length).toBe(postedBefore);
    const step10 = result.steps[9];
    const step11 = result.steps[10];
    expect(step10.proposedEntries?.length).toBe(1);
    expect(step11.proposedEntries?.length).toBe(1);
    expect(step11.draftedEntryIds?.length).toBe(1);
    // Depreciation for the Dell laptop: 3200 / 36 months, first month in service.
    const dep = drafts.find((e) => e.source === "DEPRECIATION")!;
    expect(dep.lines.find((l) => l.accountId === "acct_7700")?.debit).toBe("88.8900");
    // Second run reuses the existing drafts.
    const again = await runMonthEndClose(rt, PERIOD, OWNER);
    expect(again.draftedEntryIds.sort()).toEqual(result.draftedEntryIds.sort());
    expect(rt.dataset.journalEntries.filter((e) => e.status === "DRAFT").length).toBe(drafts.length);
  });

  it("refuses to lock without an approval and returns needsApproval with a LOCK_PERIOD action", async () => {
    const rt = await makeFixtureRuntime({ includeSuspense: false });
    const result = await runMonthEndClose(rt, PERIOD, OWNER, { lock: true });
    expect(result.locked).toBe(false);
    expect(result.steps[18].status).toBe("NEEDS_APPROVAL");
    expect(result.needsApproval?.action.kind).toBe("LOCK_PERIOD");
    expect(result.needsApproval?.action.targetIds).toContain(PERIOD);
    expect(result.needsApproval?.risk.level).toBe("YELLOW");
    expect(result.needsApproval?.risk.requiredApproverRoles).toContain("OWNER");
    expect(rt.dataset.periods.find((p) => p.id === PERIOD)?.status).toBe("OPEN");
    // A PENDING (not yet approved) approval is also refused.
    const pending = await rt.approvals.request(result.needsApproval!.action, result.needsApproval!.risk, OWNER);
    const withPending = await runMonthEndClose(rt, PERIOD, OWNER, { lock: true, approvalId: pending.id });
    expect(withPending.locked).toBe(false);
    expect(withPending.steps[18].status).toBe("NEEDS_APPROVAL");
    expect(withPending.needsApproval?.reason).toMatch(/PENDING/);
  });

  it("locks the period with a valid APPROVED LOCK_PERIOD approval", async () => {
    const rt = await makeFixtureRuntime({ includeSuspense: false });
    const approvalId = await approvedLockApproval(rt, PERIOD);
    const result = await runMonthEndClose(rt, PERIOD, OWNER, { lock: true, approvalId });
    expect(result.blockers).toHaveLength(0);
    expect(result.locked).toBe(true);
    expect(result.statusAfter).toBe("LOCKED");
    expect(result.steps[18].status).toBe("PASSED");
    const period = rt.dataset.periods.find((p) => p.id === PERIOD)!;
    expect(period.status).toBe("LOCKED");
    expect(period.lockApprovalId).toBe(approvalId);
    const ev = rt.dataset.auditEvents.find((e) => e.id === result.auditEventId)!;
    expect(ev.afterState).toMatchObject({ status: "LOCKED", locked: true });
    expect(ev.approvalIds).toContain(approvalId);
    expect(ev.finalAction).toMatch(/LOCK_PERIOD executed/);
    // Posting into the locked period is now rejected by the ledger.
    expect(() => rt.ledger.createEntry({ date: "2026-08-15", description: "late", source: "MANUAL", lines: [{ accountCode: "7000", debit: 1 }, { accountCode: "1000", credit: 1 }] }, OWNER)).toThrow(/LOCKED/);
  });

  it("refuses to lock when suspense is non-zero even with a valid approval", async () => {
    const rt = await makeFixtureRuntime({ includeSuspense: true });
    const approvalId = await approvedLockApproval(rt, PERIOD);
    const result = await runMonthEndClose(rt, PERIOD, OWNER, { lock: true, approvalId });
    expect(result.locked).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.steps[3].status).toBe("FAILED");
    expect(result.steps[3].exceptions.some((e) => isBlockingException(e) && /[Ss]uspense/.test(e))).toBe(true);
    expect(result.steps[3].exceptions.some((e) => e.includes(IDS.suspenseTx))).toBe(true);
    expect(result.steps[17].status).toBe("FAILED");
    expect(result.steps[18].status).toBe("FAILED");
    expect(result.needsApproval).toBeUndefined();
    expect(rt.dataset.periods.find((p) => p.id === PERIOD)?.status).toBe("OPEN");
  });

  it("auditor review recomputes on an isolated ledger and agrees with the controller", async () => {
    const rt = await makeFixtureRuntime({ includeSuspense: false });
    const rec = independentRecomputation(rt.dataset, "2026-08-01", "2026-08-31");
    expect(rec.isolated).toBe(true);
    expect(rec.ledger.dataset).not.toBe(rt.dataset);
    const before = rt.dataset.journalEntries.length;
    rec.ledger.createEntry({ date: "2026-08-31", description: "only in the clone", source: "MANUAL", lines: [{ accountCode: "7000", debit: 5 }, { accountCode: "1000", credit: 5 }], post: true }, OWNER);
    expect(rt.dataset.journalEntries.length).toBe(before);
    expect(rec.ledger.dataset.journalEntries.length).toBe(before + 1);
    const result = await runMonthEndClose(rt, PERIOD, OWNER);
    const auditor = result.steps[16];
    expect(auditor.status).toBe("PASSED");
    expect(auditor.details[0]).toMatch(/isolated copy/);
    expect(auditor.details.filter((d) => d.startsWith("match ")).length).toBe(7);
    expect(auditor.calcIds).toHaveLength(1);
  });

  it("honours skipSteps and rejects malformed period ids", async () => {
    const rt = await makeFixtureRuntime({ includeSuspense: false });
    const result = await runMonthEndClose(rt, PERIOD, OWNER, { skipSteps: ["cpa_package", "review_accruals"] });
    expect(result.steps[20].status).toBe("SKIPPED");
    expect(result.steps[8].status).toBe("SKIPPED");
    expect(result.cpaPackageId).toBeUndefined();
    await expect(runMonthEndClose(rt, "2026-8", OWNER)).rejects.toThrow(/YYYY-MM/);
  });
});
