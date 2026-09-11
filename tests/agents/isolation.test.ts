import { describe, expect, it } from "vitest";
import { isolateForVerification } from "@/lib/agents/isolation";
import { createAgents } from "@/lib/agents/registry";
import { OWNER, VIEWER, makeFixtureRuntime, snapshotDataset } from "./fixture";

describe("auditor isolation and permissions", () => {
  it("verification context is a fresh ledger over a cloned dataset", async () => {
    const f = await makeFixtureRuntime();
    const iso = isolateForVerification(f.ctx("auditor"));
    expect(iso.dataset).not.toBe(f.ds);
    expect(iso.ledger).not.toBe(f.rt.ledger);
    const before = snapshotDataset(f.ds);
    iso.ledger.createEntry({ date: "2026-09-05", description: "isolated scratch", source: "MANUAL", post: true, lines: [{ accountCode: "7950", debit: "1.0000" }, { accountCode: "1000", credit: "1.0000" }] }, OWNER);
    expect(iso.dataset.journalEntries.length).toBe(f.ds.journalEntries.length + 1);
    expect(snapshotDataset(f.ds)).toBe(before);
    expect(f.rt.ledger.accountBalance("acct_7950", "2026-09-09")).toBe("0.0000");
  });

  it("auditor agent verifies without touching the live dataset and still writes an audit event", async () => {
    const f = await makeFixtureRuntime();
    const { specialists } = createAgents();
    const before = snapshotDataset(f.ds);
    const res = await specialists.auditor.handle({ message: "verify", task: { kind: "controls.verify_report", params: { from: "2026-08-01", to: "2026-08-31" } }, actor: OWNER }, f.ctx("auditor"));
    expect(res.agent).toBe("auditor");
    expect(typeof res.structured.verified).toBe("boolean");
    expect(snapshotDataset(f.ds)).toBe(before);
    expect(f.ds.auditEvents.some((e) => e.id === res.auditEventId && e.agent === "auditor")).toBe(true);
  });

  it("VIEWER cannot trigger CREATE_JOURNAL_ENTRY", async () => {
    const f = await makeFixtureRuntime();
    const { specialists } = createAgents();
    const before = f.ds.journalEntries.length;
    const res = await specialists.controller.handle({ message: "draft", task: { kind: "accounting.journal_entry_draft", params: { description: "Notion", event: { type: "EXPENSE_ON_CARD", amount: 50, expenseAccountCode: "7000" } } }, actor: VIEWER }, f.ctx("controller", VIEWER));
    expect(res.escalation?.type).toBe("REFUSED_CONTROL_VIOLATION");
    expect(res.structured.permissionDenied).toBe(true);
    expect(res.toolCalls).toHaveLength(0);
    expect(res.proposedActions).toHaveLength(0);
    expect(f.ds.journalEntries.length).toBe(before);
    expect(f.ds.approvals.length).toBe(0);
  });

  it("VIEWER can still read financials", async () => {
    const f = await makeFixtureRuntime();
    const { specialists } = createAgents();
    const res = await specialists.controller.handle({ message: "tb", task: { kind: "accounting.trial_balance", params: { asOf: "2026-09-09" } }, actor: VIEWER }, f.ctx("controller", VIEWER));
    expect(res.escalation).toBeUndefined();
    expect(res.structured.balanced).toBe(true);
  });
});
