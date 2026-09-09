import { getDb } from "../src/lib/db";
import { ensureDemoWorkspace } from "../src/lib/db/seed";

process.env.FINANCE_DESK_MODE ??= "demo";
const db = getDb();
ensureDemoWorkspace(db);
console.log("Demo workspace present at", process.env.FINANCE_DESK_DB ?? "./data/finance-desk.db");
