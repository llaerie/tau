import { beforeAll, describe, expect, it } from "vitest";
import { pointAtTempDemoDb } from "../test/db";

pointAtTempDemoDb();

describe("server-side privacy", () => {
  let ctx: { will: import("./session").Viewer; arielle: import("./session").Viewer; DEMO: typeof import("../db/seed").DEMO };
  beforeAll(async () => {
    const { viewerForUserId } = await import("./session");
    const { DEMO } = await import("../db/seed");
    ctx = { will: viewerForUserId(DEMO.users.will.id)!, arielle: viewerForUserId(DEMO.users.arielle.id)!, DEMO };
  });

  it("a viewer never holds the partner's personal space", () => {
    expect(ctx.will.spaces.map((s) => s.id)).not.toContain(ctx.DEMO.spaces.arielle);
    expect(ctx.arielle.spaces.map((s) => s.id)).not.toContain(ctx.DEMO.spaces.will);
  });

  it("views and tools refuse the partner's space", async () => {
    const { buildPersonalView } = await import("../views");
    expect(() => buildPersonalView(ctx.will, ctx.DEMO.spaces.arielle)).toThrow();
    const { executeTool } = await import("../assistant/tools");
    const rows = executeTool(ctx.will, "search_transactions", { scope: "me", limit: 25 }).result as { description: string }[];
    expect(rows.every((r) => !/Arielle/i.test(r.description))).toBe(true);
  });

  it("the partner summary is coarse and respects the sharing switch", async () => {
    const { buildPartnerSummary } = await import("../views");
    const { getDb } = await import("../db");
    const s = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const summary = buildPartnerSummary(ctx.will, ctx.DEMO.persons.arielle)!;
    expect(summary.shared).toBe(true);
    expect(Object.keys(summary).sort()).toEqual(["foodStatus", "foodTargetSet", "month", "name", "personId", "savingsAllocationRoundedCents", "shared", "takeHomeStatus"]);
    getDb().update(s.userPreferences).set({ sharePersonalSummary: false }).where(eq(s.userPreferences.userId, ctx.DEMO.users.arielle.id)).run();
    const off = buildPartnerSummary(ctx.will, ctx.DEMO.persons.arielle)!;
    expect(off.shared).toBe(false);
    expect(off.foodStatus).toBe("not_shared");
    getDb().update(s.userPreferences).set({ sharePersonalSummary: true }).where(eq(s.userPreferences.userId, ctx.DEMO.users.arielle.id)).run();
  });

  it("documents in a personal space are invisible to the partner", async () => {
    const { getDb } = await import("../db");
    const s = await import("../db/schema");
    const { listDocuments, getDocument } = await import("../documents");
    getDb().insert(s.documents).values({ id: "doc_test_private", workspaceId: ctx.DEMO.workspaceId, spaceId: ctx.DEMO.spaces.arielle, uploaderUserId: ctx.DEMO.users.arielle.id, filename: "private.txt", mime: "text/plain", sizeBytes: 3, storagePath: "/nonexistent", kind: "receipt", textContent: "abc", extractedJson: null, status: "new", transactionId: null, createdAt: new Date().toISOString() }).run();
    expect(listDocuments(ctx.arielle).some((d) => d.id === "doc_test_private")).toBe(true);
    expect(listDocuments(ctx.will).some((d) => d.id === "doc_test_private")).toBe(false);
    expect(() => getDocument(ctx.will, "doc_test_private")).toThrow();
  });

  it("chat history is per user", async () => {
    const { loadHistory } = await import("../assistant/history");
    const { getDb } = await import("../db");
    const s = await import("../db/schema");
    getDb().insert(s.assistantMessages).values({ id: "msg_test_a", workspaceId: ctx.DEMO.workspaceId, userId: ctx.DEMO.users.arielle.id, role: "user", json: JSON.stringify({ role: "user", text: "secret", createdAt: new Date().toISOString() }), createdAt: new Date().toISOString() }).run();
    expect(loadHistory(ctx.DEMO.workspaceId, ctx.DEMO.users.arielle.id).some((t) => t.text === "secret")).toBe(true);
    expect(loadHistory(ctx.DEMO.workspaceId, ctx.DEMO.users.will.id).some((t) => t.text === "secret")).toBe(false);
  });
});
