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
      className="flex flex-col gap-3"
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
      <label className="block rounded-[var(--fd-radius-field)] border border-dashed border-line-2 bg-surface-2 px-4 py-4">
        <span className="label">Add a file</span>
        <input name="file" type="file" className="mt-2 block w-full text-[13.5px] text-ink-2 file:mr-3 file:min-h-[36px] file:rounded-[var(--fd-radius-pill)] file:border-0 file:bg-surface file:px-3.5 file:text-[13.5px] file:font-medium file:text-ink file:shadow-panel" accept="image/*,.pdf,.csv,.txt,text/plain" required data-testid="upload-file" />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[10rem] flex-1 text-sm">
          <span className="label">Belongs to</span>
          <select name="spaceId" className="input mt-1" data-testid="upload-space">
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="min-w-[8rem] flex-1 text-sm">
          <span className="label">Kind</span>
          <select name="kind" className="input mt-1" defaultValue="receipt">
            <option value="receipt">Receipt</option><option value="quote">Quote</option><option value="statement">Statement</option><option value="tax">Tax</option><option value="other">Other</option>
          </select>
        </label>
        <button className="btn btn-primary" disabled={busy} data-testid="upload-submit">{busy ? "Uploading…" : "Upload"}</button>
      </div>
      {error && <p className="text-[13px] text-bad">{error}</p>}
      {ok && <p className="text-[13px] text-good">{ok}</p>}
      <p className="text-[12.5px] text-ink-3">Files stay on this server, private to the space they belong to. Personal-space uploads are visible only to you. Digital text receipts are parsed; photos are stored for manual review, never guessed.</p>
    </form>
  );
}

export function DocumentList({ docs, accounts, categories, persons, meId, today }: { docs: DocumentRow[]; accounts: ExpenseAccount[]; categories: { id: string; name: string }[]; persons: { id: string; name: string }[]; meId: string | null; today: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const doc = docs.find((d) => d.id === openId) ?? null;
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  // A receipt that is not yet an expense is work. One that is recorded is history.
  const waiting = docs.filter((d) => !d.transactionId);
  const recorded = docs.filter((d) => d.transactionId);
  const groups: { key: string; title: string; hint: string; items: DocumentRow[] }[] = [
    { key: "waiting", title: "Waiting for you", hint: "Nothing here is counted anywhere yet.", items: waiting },
    { key: "recorded", title: "Recorded", hint: "Each of these is attached to an entry in Activity.", items: recorded },
  ];
  return (
    <>
      <div className="flex flex-col gap-4" data-testid="document-list">
        {groups.filter((g) => g.items.length > 0).map((g) => (
          <section key={g.key} className="card overflow-hidden" data-testid={`documents-${g.key}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">{g.title}</h2>
              <p className="text-[12.5px] text-ink-3">{g.items.length} · {g.hint}</p>
            </div>
            <ul className="divide-y divide-line">
              {g.items.map((d) => (
                <li key={d.id}>
                  <button type="button" className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2" onClick={() => setOpenId(d.id)} data-testid={`doc-${d.id}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px]">{d.filename}</span>
                      <span className="block truncate text-[12.5px] text-ink-3">
                        {dateLabel(d.createdAt.slice(0, 10))} · {d.spaceName} · {d.kind} · {(d.sizeBytes / 1024).toFixed(0)} KB
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {d.extracted?.confidence === "text" && d.extracted.amountCents !== null && !d.transactionId && (
                        <span className="fd-money text-[14px] text-ink-2">{fmt(d.extracted.amountCents)}</span>
                      )}
                      <span className={`chip ${d.transactionId ? "chip-good" : d.status === "needs_info" ? "chip-warn" : "chip-accent"}`}>{d.transactionId ? "recorded" : d.status === "needs_info" ? "needs details" : "ready to review"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Drawer open={doc !== null} onClose={() => setOpenId(null)} title={doc?.filename ?? ""} eyebrow={doc ? `${doc.spaceName} · ${doc.kind}` : undefined} testId="document-detail">
        {doc && (
          <div className="space-y-5">
            {doc.mime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/documents/${doc.id}`} alt={doc.filename} className="max-h-72 w-auto rounded-[var(--fd-radius-field)] border border-line" />
            ) : (
              <a className="link text-[13.5px]" href={`/api/documents/${doc.id}`} target="_blank" rel="noreferrer">Open file</a>
            )}
            <div>
              <p className="label">What the file says</p>
              {doc.extracted?.confidence === "text" ? (
                <>
                  <dl className="mt-2 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 rounded-[var(--fd-radius-field)] bg-surface-2 px-3 py-2 text-[13.5px]"><dt className="text-ink-3">Merchant</dt><dd>{doc.extracted.merchant ?? "not found"}</dd></div>
                    <div className="flex items-baseline justify-between gap-3 rounded-[var(--fd-radius-field)] bg-surface-2 px-3 py-2 text-[13.5px]"><dt className="text-ink-3">Total</dt><dd className="fd-money">{doc.extracted.amountCents === null ? "not found" : fmt(doc.extracted.amountCents)}</dd></div>
                    <div className="flex items-baseline justify-between gap-3 rounded-[var(--fd-radius-field)] bg-surface-2 px-3 py-2 text-[13.5px]"><dt className="text-ink-3">Date</dt><dd>{doc.extracted.date ?? "not found"}</dd></div>
                  </dl>
                  <p className="mt-2 text-[12.5px] text-ink-3">Read from the file&rsquo;s own text. Check it against the receipt before you record it.</p>
                </>
              ) : (
                <p className="mt-2 text-[13.5px] text-ink-2">No digital text to parse. Enter the amount and date from the receipt yourself.</p>
              )}
            </div>
            {doc.transactionId ? (
              <p className="rounded-[var(--fd-radius-field)] bg-surface-2 px-3 py-2.5 text-[13.5px]">Recorded as an expense. See it in Activity.</p>
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
