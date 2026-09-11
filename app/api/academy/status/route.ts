import { withApi, json } from "@/lib/ui/api";
import { currentJob } from "@/lib/ui/evals";

export const GET = withApi(async () => {
  const job = currentJob();
  return json({ job });
}, "VIEW_FINANCIALS");
