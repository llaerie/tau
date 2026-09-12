import type { ExpenseAccount } from "@/components/activity/RecordExpense";
import { DocumentList, UploadForm, type DocumentRow } from "@/components/documents/DocumentsPanel";
import { Disclosure } from "@/components/money/Panels";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { canEdit } from "@/lib/auth/authorize";
import { loadSpaceData } from "@/lib/data/spaces";
import { listDocuments } from "@/lib/documents";
import { todayIso } from "@/lib/ids";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const viewer = await requireViewer();
  const mine = viewer.spaces.find((x) => x.kind === "personal" && x.personId === viewer.person?.id);
  const spaces = viewer.spaces.filter((x) => (x.kind !== "personal" || x.id === mine?.id) && canEdit(viewer, x.id));
  const docs = listDocuments(viewer);
  const accounts: ExpenseAccount[] = [];
  let categories: { id: string; name: string }[] = [];
  for (const space of spaces) {
    const data = loadSpaceData(viewer, space);
    categories = data.categories.map((c) => ({ id: c.id, name: c.name }));
    for (const a of data.accounts.filter((x) => !x.isArchived)) accounts.push({ id: a.id, name: a.name, spaceId: space.id, spaceName: space.name, spaceKind: space.kind });
  }
  const rows: DocumentRow[] = docs.map((d) => ({ id: d.id, filename: d.filename, mime: d.mime, sizeBytes: d.sizeBytes, kind: d.kind, status: d.status, spaceId: d.spaceId, spaceName: viewer.spaces.find((x) => x.id === d.spaceId)?.name ?? "space", createdAt: d.createdAt, transactionId: d.transactionId, extracted: d.extractedJson ? JSON.parse(d.extractedJson) : null }));
  const waiting = rows.filter((d) => !d.transactionId).length;
  return (
    <>
      <PageHeader title="Documents" description="Receipts, quotes and statements. Review a receipt, then record it as an expense with a preview first." />
      {waiting > 0 && (
        <p className="mb-4 rounded-[var(--fd-radius-card)] border border-line bg-warn-soft px-4 py-3 text-[14px]" data-testid="documents-waiting">
          <strong className="font-semibold">{waiting} file{waiting === 1 ? "" : "s"} not recorded yet.</strong>{" "}
          <span className="text-ink-2">A stored receipt changes nothing on its own. Open one to record it as an expense.</span>
        </p>
      )}
      <div className="mb-5">
        <Disclosure title="Upload a file" hint="Receipts, quotes, statements and tax documents." testId="upload-card" defaultOpen>
          <UploadForm spaces={spaces.map((s) => ({ id: s.id, name: s.kind === "personal" ? `${s.name} (private)` : s.name }))} />
        </Disclosure>
      </div>
      {rows.length === 0 ? <EmptyState title="No documents yet">Upload a receipt to start. A CSV or text receipt is parsed for amount and date; photos are stored for manual entry.</EmptyState> : <DocumentList docs={rows} accounts={accounts} categories={categories} persons={viewer.persons.map((p) => ({ id: p.id, name: p.name }))} meId={viewer.person?.id ?? null} today={todayIso()} />}
    </>
  );
}
