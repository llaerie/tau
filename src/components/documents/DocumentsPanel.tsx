"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RecordExpense, type ExpenseAccount } from "@/components/activity/RecordExpense";
import { Drawer } from "@/components/Drawer";
import { dateLabel } from "@/components/ui";

export interface DocumentRow {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  kind: string;
  status: string;
  spaceId: string;
  spaceName: string;
  createdAt: string;
  transactionId: string | null;
  extracted: { amountCents: number | null; date: string | null; merchant: string | null; confidence: "text" | "none" } | null;
}

export function UploadForm({ spaces }: { spaces: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        setOk(null);
        try {
          const res = await fetch("/api/documents", { method: "POST", body: fd });
          const json = (await res.json()) as { error?: string; document?: { filename: string } };
          if (!res.ok) throw new Error(json.error ?? "Upload failed.");
          setOk(`Stored ${json.document?.filename ?? "file"}.`);
          (e.target as HTMLFormElement).reset();
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed.");
        } finally {
          setBusy(false);
        }
      }}
      data-testid="upload-form"
    >
      <label className="text-sm">
        <span className="label">File</span>
        <input name="file" type="file" className="input mt-1" accept="image/*,.pdf,.csv,.txt,text/plain" required data-testid="upload-file" />
      </label>
      <label className="text-sm">
        <span className="label">Belongs to</span>
        <select name="spaceId" className="input mt-1" data-testid="upload-space">
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="label">Kind</span>
        <select name="kind" className="input mt-1" defaultValue="receipt">
          <option value="receipt">Receipt</option><option value="quote">Quote</option><option value="statement">Statement</option><option value="tax">Tax</option><option value="other">Other</option>
        </select>
      </label>
      <button className="btn btn-primary" disabled={busy} data-testid="upload-submit">{busy ? "Uploading…" : "Upload"}</button>
      {error && <p className="text-[13px] text-bad sm:col-span-4">{error}</p>}
      {ok && <p className="text-[13px] text-good sm:col-span-4">{ok}</p>}
      <p className="text-[12px] text-ink-3 sm:col-span-4">Files stay on this server, private to the space they belong to. Personal-space uploads are visible only to you. Digital text receipts are parsed; photos are stored for manual review, never guessed.</p>
    </form>
  );
}

export function DocumentList({ docs, accounts, categories, persons, meId, today }: { docs: DocumentRow[]; accounts: ExpenseAccount[]; categories: { id: string; name: string }[]; persons: { id: string; name: string }[]; meId: string | null; today: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const doc = docs.find((d) => d.id === openId) ?? null;
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  return (
    <>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="document-list">
        {docs.map((d) => (
          <li key={d.id}>
            <button type="button" className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2" onClick={() => setOpenId(d.id)} data-testid={`doc-${d.id}`}>
              <span className="w-12 shrink-0 text-[12px] text-ink-3">{dateLabel(d.createdAt.slice(0, 10))}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{d.filename}</span>
                <span className="block truncate text-[11.5px] text-ink-3">{d.spaceName} · {d.kind} · {(d.sizeBytes / 1024).toFixed(0)} KB</span>
              </span>
              <span className={`chip ${d.transactionId ? "chip-good" : d.status === "needs_info" ? "chip-warn" : "chip-accent"}`}>{d.transactionId ? "recorded" : d.status === "needs_info" ? "needs details" : "ready to review"}</span>
            </button>
          </li>
        ))}
      </ul>
      <Drawer open={doc !== null} onClose={() => setOpenId(null)} title={doc?.filename ?? ""} eyebrow={doc ? `${doc.spaceName} · ${doc.kind}` : undefined} testId="document-detail">
        {doc && (
          <div className="space-y-4">
            {doc.mime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/documents/${doc.id}`} alt={doc.filename} className="max-h-72 w-auto rounded-lg border border-line" />
            ) : (
              <a className="link text-[13px]" href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer">Open file</a>
            )}
            <div>
              <p className="label">Extracted</p>
              {doc.extracted?.confidence === "text" ? (
                <dl className="mt-1 divide-y divide-line rounded-lg border border-line text-[13px]">
                  <div className="flex justify-between px-3 py-1.5"><dt className="text-ink-3">Merchant</dt><dd>{doc.extracted.merchant ?? "not found"}</dd></div>
                  <div className="flex justify-between px-3 py-1.5"><dt className="text-ink-3">Total</dt><dd className="num">{doc.extracted.amountCents === null ? "not found" : fmt(doc.extracted.amountCents)}</dd></div>
                  <div className="flex justify-between px-3 py-1.5"><dt className="text-ink-3">Date</dt><dd>{doc.extracted.date ?? "not found"}</dd></div>
                </dl>
              ) : (
                <p className="mt-1 text-[13px] text-ink-2">No digital text to parse. Enter the amount and date from the receipt yourself.</p>
              )}
            </div>
            {doc.transactionId ? (
              <p className="text-[13px] text-good">Recorded as an expense. See it in Activity.</p>
            ) : (
              <div>
                <p className="label mb-2">Record from this receipt</p>
                <RecordExpense
                  accounts={accounts.filter((a) => a.spaceId === doc.spaceId)}
                  categories={categories}
                  persons={persons}
                  meId={meId}
                  today={today}
                  documentId={doc.id}
                  initial={{ amount: doc.extracted?.amountCents != null ? (doc.extracted.amountCents / 100).toFixed(2) : "", description: doc.extracted?.merchant ?? doc.filename.replace(/\.[a-z0-9]+$/i, ""), date: doc.extracted?.date ?? today }}
                />
              </div>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
