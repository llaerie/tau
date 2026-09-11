import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import * as s from "../db/schema";
import type { AssistantTurn } from "./envelope";

/** Chat history is private to the signed-in user; it never crosses users. */
export function loadHistory(workspaceId: string, userId: string, limit = 60): AssistantTurn[] {
  const rows = getDb().select().from(s.assistantMessages).where(and(eq(s.assistantMessages.workspaceId, workspaceId), eq(s.assistantMessages.userId, userId))).orderBy(asc(s.assistantMessages.createdAt)).all();
  return rows.slice(-limit).map((m) => JSON.parse(m.json) as AssistantTurn);
}
