import { inArray } from "drizzle-orm";
import { CsvImport } from "@/components/forms/CsvImport";
import { Card, Notice, PageHeader } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { canEdit } from "@/lib/auth/authorize";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";

export const metadata = { title: "Import CSV" };

export default async function ImportPage() {
  const viewer = await requireViewer();
  const editable = viewer.spaces.filter((x) => canEdit(viewer, x.id));
  const accounts = viewer.spaces.length ? getDb().select().from(s.accounts).where(inArray(s.accounts.spaceId, viewer.spaces.map((x) => x.id))).all() : [];
  return (
    <>
      <PageHeader eyebrow="Ledger" title="Import a CSV export" description="Upload a statement export from your bank. Columns are detected, rows are previewed, and duplicates already in the ledger are skipped. No bank connection is involved." />
      <div className="mb-4">
        <Notice tone="neutral">Bank, payroll and accounting integrations are not connected. Manual entry and CSV import are the two ways data gets in.</Notice>
      </div>
      <Card>
        <CsvImport
          accounts={accounts
            .filter((a) => editable.some((x) => x.id === a.spaceId))
            .map((a) => ({ id: a.id, name: a.name, spaceId: a.spaceId, spaceName: viewer.spaces.find((x) => x.id === a.spaceId)?.name ?? "" }))}
          allAccounts={accounts.map((a) => ({ id: a.id, name: a.name, spaceName: viewer.spaces.find((x) => x.id === a.spaceId)?.name ?? "" }))}
        />
      </Card>
    </>
  );
}
