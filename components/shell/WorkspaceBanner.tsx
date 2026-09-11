import Link from "next/link";
import { currentWorkspace } from "@/lib/db/workspace";
import { getRuntime } from "@/lib/db/runtime";
import { unknownsRegistry } from "@/lib/knowledge/finance-bible";
import { mergedConfigFields } from "@/lib/ui/config";

export const COMPANY_BANNER_TEXT = "YOUR COMPANY WORKSPACE — Phase Two read-only: no bank, card, payroll or accounting connection exists; books contain only what you enter or import";

/**
 * Workspace banner. In the company workspace it states plainly that nothing is connected and
 * links to the setup checklist while it is incomplete. In the lab the Shell renders its own
 * synthetic-data banner, so this component renders nothing there.
 */
export async function WorkspaceBanner() {
  if (currentWorkspace() !== "company") return null;
  let open: number | null = null;
  let total: number | null = null;
  try {
    const rt = await getRuntime();
    const registry = unknownsRegistry(mergedConfigFields(rt.bible, rt.dataset.configFields));
    total = registry.length;
    open = registry.filter((r) => r.status !== "CONFIRMED").length;
  } catch {
    // Runtime unavailable: still show the banner without the completeness link.
  }
  const incomplete = open !== null && open > 0;
  return (
    <div className="sticky top-0 z-40 border-b border-accent/40 bg-accent-soft px-4 py-1.5 text-center text-[12px] font-semibold tracking-wide text-accent" role="status">
      {COMPANY_BANNER_TEXT}
      {incomplete ? (
        <>
          {" · "}
          <Link href="/company" className="underline">
            Finance setup {total !== null ? `${total - (open ?? 0)}/${total}` : ""} complete — finish setup →
          </Link>
        </>
      ) : null}
    </div>
  );
}
