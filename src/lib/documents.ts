import { and, desc, eq, inArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { assertSpaceAccess, AuthorizationError } from "./auth/authorize";
import type { Viewer } from "./auth/session";
import { getDb } from "./db";
import * as s from "./db/schema";
import { getConfig } from "./config";
import { newId, nowIso, todayIso } from "./ids";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf", "text/plain", "text/csv"]);

function uploadsDir(): string {
  const base = path.resolve(process.cwd(), path.dirname(getConfig().dbPath), "uploads");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export interface ExtractedReceipt {
  amountCents: number | null;
  date: string | null;
  merchant: string | null;
  confidence: "text" | "none";
}

/**
 * Read a printed amount without guessing. A separator is the decimal point only
 * when exactly two digits follow it, so "1,399.00", "1.399,00" and "1,399" all
 * mean one thousand three hundred and ninety-nine dollars, and "12,50" means
 * twelve fifty. Anything that is not a plain grouped number returns null rather
 * than a number that happens to parse.
 */
export function parseAmountCents(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d[\d.,]*$/.test(text)) return null;
  const sep = Math.max(text.lastIndexOf(","), text.lastIndexOf("."));
  const hasFraction = sep !== -1 && text.length - sep - 1 === 2;
  const whole = (hasFraction ? text.slice(0, sep) : text).replace(/[.,]/g, "");
  const fraction = hasFraction ? text.slice(sep + 1) : "";
  if (!/^\d+$/.test(whole) || whole.length > 12) return null;
  const cents = Number(whole) * 100 + (fraction ? Number(fraction) : 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Parse digital text only. Image receipts are stored and reviewed by hand;
 * no fabricated OCR. Document text is data, never instructions.
 */
export function extractReceipt(text: string | null): ExtractedReceipt {
  if (!text) return { amountCents: null, date: null, merchant: null, confidence: "none" };
  const clean = text.replace(/\r/g, "");
  const totalMatch = clean.match(/(?:total|amount due|grand total)[^\d$]*\$?\s*(\d[\d.,]*\d|\d)/i) ?? clean.match(/\$\s*(\d[\d.,]*\d|\d)/);
  const amountCents = totalMatch ? parseAmountCents(totalMatch[1]) : null;
  const dateMatch = clean.match(/(\d{4}-\d{2}-\d{2})/) ?? clean.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  let date: string | null = null;
  if (dateMatch) {
    if (dateMatch.length === 2) date = dateMatch[1];
    else date = `${dateMatch[3].length === 2 ? "20" + dateMatch[3] : dateMatch[3]}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`;
  }
  const firstLine = clean.split("\n").map((l) => l.trim()).find((l) => l.length > 2 && !/^\d/.test(l) && !/receipt|invoice|total|thank/i.test(l)) ?? null;
  return { amountCents, date, merchant: firstLine ? firstLine.slice(0, 80) : null, confidence: "text" };
}

export async function storeDocument(viewer: Viewer, spaceId: string, file: File, kind: s.Document["kind"] = "receipt"): Promise<s.Document> {
  assertSpaceAccess(viewer, spaceId, "edit");
  if (file.size > MAX_BYTES) throw new Error("That file is larger than 8 MB.");
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) throw new Error("Upload a PNG, JPEG, WebP, HEIC, PDF, CSV or text file.");
  const id = newId("doc");
  const dir = path.join(uploadsDir(), viewer.workspace.id);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file.name).slice(0, 10).replace(/[^a-z0-9.]/gi, "") || "";
  const storagePath = path.join(dir, `${id}${ext}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(storagePath, buffer, { mode: 0o600 });
  const textContent = mime.startsWith("text/") ? buffer.toString("utf8").slice(0, 20000) : null;
  const extracted = extractReceipt(textContent);
  const row: typeof s.documents.$inferInsert = { id, workspaceId: viewer.workspace.id, spaceId, uploaderUserId: viewer.user.id, filename: file.name.slice(0, 200), mime, sizeBytes: file.size, storagePath, kind, textContent, extractedJson: JSON.stringify(extracted), status: extracted.amountCents !== null && extracted.date !== null ? "new" : "needs_info", transactionId: null, createdAt: nowIso() };
  getDb().insert(s.documents).values(row).run();
  return getDb().select().from(s.documents).where(eq(s.documents.id, id)).get()!;
}

/** Documents the viewer may see: only spaces they hold a role on. */
export function listDocuments(viewer: Viewer): s.Document[] {
  const ids = viewer.spaces.map((sp) => sp.id);
  if (!ids.length) return [];
  return getDb().select().from(s.documents).where(and(eq(s.documents.workspaceId, viewer.workspace.id), inArray(s.documents.spaceId, ids))).orderBy(desc(s.documents.createdAt)).all();
}

export function getDocument(viewer: Viewer, id: string): s.Document {
  const doc = getDb().select().from(s.documents).where(and(eq(s.documents.id, id), eq(s.documents.workspaceId, viewer.workspace.id))).get();
  if (!doc || !viewer.spaces.some((sp) => sp.id === doc.spaceId)) throw new AuthorizationError("Document not found.");
  return doc;
}

export function readDocumentFile(viewer: Viewer, id: string): { doc: s.Document; bytes: Buffer } {
  const doc = getDocument(viewer, id);
  return { doc, bytes: fs.readFileSync(doc.storagePath) };
}

export function defaultReceiptDate(): string {
  return todayIso();
}
