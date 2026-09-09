import { getDb } from "../src/lib/db";
import { resetDemoWorkspace } from "../src/lib/db/seed";

process.env.FINANCE_DESK_MODE ??= "demo";
resetDemoWorkspace(getDb());
console.log("Demo workspace reset.");
