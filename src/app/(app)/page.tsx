import { AssistantHome } from "@/components/assistant/AssistantHome";
import { requireViewer } from "@/lib/actions/helpers";
import { loadHistory } from "@/lib/assistant/history";
import { getConfig } from "@/lib/config";
import { loadPreferences } from "@/lib/data/spaces";
import { buildBriefing } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const viewer = await requireViewer();
  const config = getConfig();
  const briefing = buildBriefing(viewer);
  const prefs = loadPreferences(viewer.user.id);
  const history = loadHistory(viewer.workspace.id, viewer.user.id, 40);
  const scopes = [
    ...(viewer.spaces.some((sp) => sp.kind === "personal" && sp.personId === viewer.person?.id) ? (["me"] as const) : []),
    ...(viewer.spaces.some((sp) => sp.kind === "company") ? (["company"] as const) : []),
    ...(viewer.spaces.some((sp) => sp.kind === "household") ? (["household"] as const) : []),
  ];
  const partner = viewer.persons.find((p) => p.id !== viewer.person?.id) ?? null;
  return <AssistantHome briefing={briefing} initialHistory={history} scopes={scopes.length ? [...scopes] : ["me"]} connected={!!config.anthropicApiKey} model={config.model} spokenReplies={prefs.spokenReplies} partnerName={partner?.name ?? null} />;
}
