"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSpaceAccess } from "../auth/authorize";
import { getDb } from "../db";
import * as s from "../db/schema";
import { detectMapping, hashRow, mapRows, parseCsv, type ImportedRow } from "../finance/csv";
import { newId, nowIso } from "../ids";
import { ActionError, moneyRequired, requireViewer, runAction, str, type ActionResult } from "./helpers";

const KINDS = ["income", "expense", "bill_payment", "transfer", "cc_payment", "savings_allocation", "payroll_withholding"] as const;

const txnSchema = z.object({
  spaceId: z.string().min(1),
  accountId: z.string().min(1),
  counterAccountId: z.string().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  amountCents: z.number().int().positive("Amount must be more than zero"),
  kind: z.enum(KINDS),
  categoryId: z.string().nullable(),
  billId: z.string().nullable(),
  goalId: z.string().nullable(),
  description: z.string().min(1, "Description is required").max(200),
});

function accountSpace(accountId: string): s.Account {
  const acc = getDb().select().from(s.accounts).where(eq(s.accounts.id, accountId)).get();
  if (!acc) throw new ActionError("Unknown account.");
  return acc;
}

export async function createTransaction(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const input = txnSchema.parse({
      spaceId: str(fd, "spaceId"),
      accountId: str(fd, "accountId"),
      counterAccountId: str(fd, "counterAccountId") || null,
      date: str(fd, "date"),
      amountCents: moneyRequired(fd, "amount", "Amount"),
      kind: str(fd, "kind"),
      categoryId: str(fd, "categoryId") || null,
      billId: str(fd, "billId") || null,
      goalId: str(fd, "goalId") || null,
      description: str(fd, "description"),
    });
    assertSpaceAccess(viewer, input.spaceId, "edit");
    const acc = accountSpace(input.accountId);
    if (acc.spaceId !== input.spaceId) throw new ActionError("That account does not belong to this space.");
    if (["transfer", "cc_payment", "savings_allocation"].includes(input.kind)) {
      if (!input.counterAccountId) throw new ActionError("Choose the receiving account for a transfer.");
      const counter = accountSpace(input.counterAccountId);
      // The counter account may live in another space; the viewer must be able to see it.
      assertSpaceAccess(viewer, counter.spaceId, "view");
      if (counter.id === acc.id) throw new ActionError("A transfer needs two different accounts.");
    } else {
      input.counterAccountId = null;
    }
    getDb()
      .insert(s.transactions)
      .values({ ...input, id: newId("txn"), importHash: null, source: "manual", createdBy: viewer.user.id, createdAt: nowIso() })
      .run();
    revalidatePath("/", "layout");
  });
}

export async function updateTransactionKind(id: string, kind: string, extra: { categoryId?: string | null; billId?: string | null; goalId?: string | null } = {}): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const db = getDb();
    const txn = db.select().from(s.transactions).where(eq(s.transactions.id, id)).get();
    if (!txn) throw new ActionError("Transaction not found.");
    assertSpaceAccess(viewer, txn.spaceId, "edit");
    const k = z.enum(KINDS).parse(kind);
    if (["transfer", "cc_payment", "savings_allocation"].includes(k) && !txn.counterAccountId) throw new ActionError("Set a receiving account before classifying this as a transfer.");
    db.update(s.transactions).set({ kind: k, ...extra }).where(eq(s.transactions.id, id)).run();
    revalidatePath("/", "layout");
  });
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const db = getDb();
    const txn = db.select().from(s.transactions).where(eq(s.transactions.id, id)).get();
    if (!txn) throw new ActionError("Transaction not found.");
    assertSpaceAccess(viewer, txn.spaceId, "edit");
    db.delete(s.transactions).where(eq(s.transactions.id, id)).run();
    revalidatePath("/", "layout");
  });
}

export interface CsvPreview {
  headers: string[];
  mapping: ReturnType<typeof detectMapping>;
  rows: (ImportedRow & { duplicate: boolean })[];
  accountId: string;
  spaceId: string;
}

export async function previewCsv(_prev: ActionResult<CsvPreview> | undefined, fd: FormData): Promise<ActionResult<CsvPreview>> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const accountId = str(fd, "accountId");
    const acc = accountSpace(accountId);
    assertSpaceAccess(viewer, acc.spaceId, "edit");
    const file = fd.get("file");
    const text = file instanceof File ? await file.text() : str(fd, "text");
    if (!text.trim()) throw new ActionError("Choose a CSV file first.");
    if (text.length > 2_000_000) throw new ActionError("That file is larger than 2 MB.");
    const table = parseCsv(text);
    if (!table.headers.length || !table.rows.length) throw new ActionError("No rows found in that CSV.");
    const mapping = detectMapping(table.headers);
    if (str(fd, "invertSign") === "1") mapping.invertSign = true;
    const rows = mapRows(table, mapping).slice(0, 2000);
    const existing = new Set(
      getDb()
        .select({ h: s.transactions.importHash })
        .from(s.transactions)
        .where(and(eq(s.transactions.accountId, accountId), inArray(s.transactions.importHash, rows.map((r) => r.hash))))
        .all()
        .map((r) => r.h),
    );
    return { headers: table.headers, mapping, rows: rows.map((r) => ({ ...r, duplicate: existing.has(r.hash) })), accountId, spaceId: acc.spaceId };
  });
}

const commitRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(200),
  amountCents: z.number().int(),
  kind: z.enum(KINDS),
  counterAccountId: z.string().nullable().optional(),
});

export async function commitCsvImport(accountId: string, rowsJson: string): Promise<ActionResult<{ imported: number; skipped: number }>> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const acc = accountSpace(accountId);
    assertSpaceAccess(viewer, acc.spaceId, "edit");
    const rows = z.array(commitRow).max(2000).parse(JSON.parse(rowsJson));
    const db = getDb();
    const hashes = rows.map((r) => hashRow(r.date, r.amountCents, r.description));
    const existing = new Set(
      hashes.length
        ? db.select({ h: s.transactions.importHash }).from(s.transactions).where(and(eq(s.transactions.accountId, accountId), inArray(s.transactions.importHash, hashes))).all().map((r) => r.h)
        : [],
    );
    let imported = 0;
    let skipped = 0;
    const createdAt = nowIso();
    db.transaction((tx) => {
      rows.forEach((r, i) => {
        const hash = hashes[i];
        if (existing.has(hash) || r.amountCents === 0) {
          skipped++;
          return;
        }
        const needsCounter = ["transfer", "cc_payment", "savings_allocation"].includes(r.kind);
        if (needsCounter) {
          if (!r.counterAccountId) throw new ActionError(`Row "${r.description}" is a transfer but has no receiving account.`);
          const counter = accountSpace(r.counterAccountId);
          assertSpaceAccess(viewer, counter.spaceId, "view");
        }
        tx.insert(s.transactions)
          .values({
            id: newId("txn"),
            spaceId: acc.spaceId,
            accountId,
            counterAccountId: needsCounter ? r.counterAccountId : null,
            date: r.date,
            amountCents: Math.abs(r.amountCents),
            kind: r.kind,
            categoryId: null,
            billId: null,
            goalId: null,
            description: r.description,
            importHash: hash,
            source: "csv",
            createdBy: viewer.user.id,
            createdAt,
          })
          .run();
        existing.add(hash);
        imported++;
      });
    });
    revalidatePath("/", "layout");
    return { imported, skipped };
  });
}
