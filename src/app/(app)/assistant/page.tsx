import { and, asc, eq } from "drizzle-orm";
import { AssistantChat } from "@/components/AssistantChat";
import { Notice, PageHeader } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import type { AssistantTurn } from "@/lib/assistant/run";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";

export const metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const viewer = await requireViewer();
  const config = getConfig();
  const history = getDb()
    .select()
    .from(s.assistantMessages)
    .where(and(eq(s.assistantMessages.workspaceId, viewer.workspace.id), eq(s.assistantMessages.userId, viewer.user.id)))
    .orderBy(asc(s.assistantMessages.createdAt))
    .all()
    .map((m) => JSON.parse(m.json) as AssistantTurn);
  const connected = !!config.anthropicApiKey;
  return (
    <>
      <PageHeader eyebrow="Assistant" title="Ask about the numbers" description="Answers are built from the same deterministic tools as the dashboards. The model explains; it never calculates." />
      <div className="mb-4">
        {connected ? (
          <Notice tone="good">Claude is connected ({config.model}). Every figure in a reply comes from a tool call shown beneath it.</Notice>
        ) : (
          <Notice tone="unknown">No model connected. Replies are deterministic previews: the question is routed to the tools and their results are shown with fixed wording. Set ANTHROPIC_API_KEY to enable Claude.</Notice>
        )}
      </div>
      <AssistantChat initial={history} connected={connected} personName={viewer.person?.name ?? viewer.user.name} />
    </>
  );
}
