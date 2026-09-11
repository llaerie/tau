import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("memberships_ws_user_idx").on(t.workspaceId, t.userId)],
);

export const persons = sqliteTable(
  "persons",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    title: text("title"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("persons_ws_slug_idx").on(t.workspaceId, t.slug)],
);

export const spaces = sqliteTable(
  "spaces",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["company", "household", "personal"] }).notNull(),
    name: text("name").notNull(),
    personId: text("person_id").references(() => persons.id, { onDelete: "cascade" }),
  },
  (t) => [index("spaces_ws_idx").on(t.workspaceId)],
);

export const spacePermissions = sqliteTable(
  "space_permissions",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
  },
  (t) => [uniqueIndex("space_permissions_space_user_idx").on(t.spaceId, t.userId), index("space_permissions_user_idx").on(t.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: ["checking", "savings", "credit_card", "cash", "other"] }).notNull(),
    institution: text("institution"),
    /** Null = balance unknown. */
    openingBalanceCents: integer("opening_balance_cents"),
    openingBalanceAsOf: text("opening_balance_as_of"),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("accounts_space_idx").on(t.spaceId)],
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    group: text("group").notNull(),
  },
  (t) => [uniqueIndex("categories_ws_name_idx").on(t.workspaceId, t.name)],
);

export const bills = sqliteTable(
  "bills",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Null = amount unknown. */
    amountCents: integer("amount_cents"),
    cadence: text("cadence", { enum: ["weekly", "monthly", "quarterly", "annual", "one_time"] }).notNull(),
    dueDay: integer("due_day"),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    /** Space whose account pays the bill. Null = the bill's own space. */
    payerSpaceId: text("payer_space_id").references(() => spaces.id, { onDelete: "set null" }),
    beneficiary: text("beneficiary", { enum: ["company", "household", "person", "split"] }),
    purpose: text("purpose", { enum: ["business", "personal", "mixed", "unresolved"] }),
    treatment: text("treatment"),
    source: text("source", { enum: ["user", "template", "demo"] }).notNull().default("user"),
  },
  (t) => [index("bills_space_idx").on(t.spaceId)],
);

export const goals = sqliteTable(
  "goals",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Null = monthly target unknown. */
    monthlyTargetCents: integer("monthly_target_cents"),
    priority: integer("priority").notNull().default(1),
    targetTotalCents: integer("target_total_cents"),
    savedCents: integer("saved_cents").notNull().default(0),
    rule: text("rule"),
    accountId: text("account_id").references(() => accounts.id, { onDelete: "set null" }),
    source: text("source", { enum: ["user", "template", "demo"] }).notNull().default("user"),
    archivedAt: text("archived_at"),
  },
  (t) => [index("goals_space_idx").on(t.spaceId)],
);

export const budgets = sqliteTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Null = planned amount unknown. */
    monthlyCents: integer("monthly_cents"),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    source: text("source", { enum: ["user", "template", "demo"] }).notNull().default("user"),
    archivedAt: text("archived_at"),
  },
  (t) => [index("budgets_space_idx").on(t.spaceId)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    counterAccountId: text("counter_account_id").references(() => accounts.id, { onDelete: "set null" }),
    date: text("date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    kind: text("kind", { enum: ["income", "expense", "bill_payment", "transfer", "cc_payment", "savings_allocation", "payroll_withholding"] }).notNull(),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    billId: text("bill_id").references(() => bills.id, { onDelete: "set null" }),
    goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    importHash: text("import_hash"),
    source: text("source", { enum: ["manual", "csv", "seed", "receipt", "assistant"] }).notNull().default("manual"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    economicEventId: text("economic_event_id"),
    beneficiary: text("beneficiary", { enum: ["company", "household", "person", "split"] }),
    purpose: text("purpose", { enum: ["business", "personal", "mixed", "unresolved"] }),
    treatment: text("treatment"),
    reviewStatus: text("review_status", { enum: ["none", "review_required", "reviewed"] }).notNull().default("none"),
    documentId: text("document_id"),
    payerPersonId: text("payer_person_id").references(() => persons.id, { onDelete: "set null" }),
    voidedAt: text("voided_at"),
    voidReason: text("void_reason"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("transactions_space_date_idx").on(t.spaceId, t.date), index("transactions_account_idx").on(t.accountId), index("transactions_hash_idx").on(t.accountId, t.importHash), index("transactions_event_idx").on(t.economicEventId)],
);

export const assumptions = sqliteTable("assumptions", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  json: text("json").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

export const scenarios = sqliteTable(
  "scenarios",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    kind: text("kind", { enum: ["one_time", "recurring"] }).notNull(),
    recurringMonths: integer("recurring_months"),
    startMonthOffset: integer("start_month_offset").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("scenarios_ws_idx").on(t.workspaceId)],
);

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    personName: text("person_name").notNull(),
    /** JSON: { [spaceId]: "owner" | "editor" | "viewer" } */
    spaceRolesJson: text("space_roles_json").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    acceptedByUserId: text("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("invites_code_idx").on(t.code)],
);

export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    /** JSON AssistantTurn */
    json: text("json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("assistant_messages_user_idx").on(t.workspaceId, t.userId, t.createdAt)],
);

export const expenseShares = sqliteTable(
  "expense_shares",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    economicEventId: text("economic_event_id").notNull(),
    personId: text("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
    cents: integer("cents").notNull(),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    date: text("date").notNull(),
    settledAt: text("settled_at"),
  },
  (t) => [index("expense_shares_person_idx").on(t.personId, t.date), index("expense_shares_txn_idx").on(t.transactionId)],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    product: text("product").notNull(),
    tier: text("tier"),
    kind: text("kind", { enum: ["subscription", "api_usage", "saas"] }).notNull().default("subscription"),
    quantity: integer("quantity").notNull().default(1),
    /** Null = price not confirmed. */
    unitPriceCents: integer("unit_price_cents"),
    currency: text("currency").notNull().default("USD"),
    interval: text("interval", { enum: ["monthly", "annual"] }).notNull().default("monthly"),
    renewalDate: text("renewal_date"),
    taxCents: integer("tax_cents"),
    status: text("status", { enum: ["planned", "active", "cancelled"] }).notNull().default("planned"),
    accountStatus: text("account_status", { enum: ["existing", "new", "unknown"] }).notNull().default("unknown"),
    /** JSON array of person ids. */
    usersJson: text("users_json").notNull().default("[]"),
    evidence: text("evidence"),
    verifiedAt: text("verified_at"),
    cancellationInfo: text("cancellation_info"),
    notes: text("notes"),
    source: text("source", { enum: ["user", "template", "demo"] }).notNull().default("user"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("subscriptions_ws_idx").on(t.workspaceId)],
);

export const purchasePlans = sqliteTable(
  "purchase_plans",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** Space whose account is intended to pay. */
    payerSpaceId: text("payer_space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category", { enum: ["hardware", "furniture", "software", "travel", "other"] }).notNull().default("other"),
    specification: text("specification"),
    quantity: integer("quantity").notNull().default(1),
    /** Null = price unknown. */
    unitPriceCents: integer("unit_price_cents"),
    taxShippingCents: integer("tax_shipping_cents"),
    targetMonth: text("target_month"),
    fundingAccountId: text("funding_account_id").references(() => accounts.id, { onDelete: "set null" }),
    beneficiary: text("beneficiary", { enum: ["company", "household", "person", "split"] }).notNull().default("company"),
    beneficiaryPersonId: text("beneficiary_person_id").references(() => persons.id, { onDelete: "set null" }),
    purpose: text("purpose", { enum: ["business", "personal", "mixed", "unresolved"] }).notNull().default("unresolved"),
    treatment: text("treatment").notNull().default("review_required"),
    status: text("status", { enum: ["planned", "approved", "purchased", "cancelled"] }).notNull().default("planned"),
    quoteDocumentId: text("quote_document_id"),
    notes: text("notes"),
    source: text("source", { enum: ["user", "template", "demo"] }).notNull().default("user"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("purchase_plans_ws_idx").on(t.workspaceId)],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** Privacy scope: a personal space keeps the document private to its person. */
    spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    uploaderUserId: text("uploader_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    kind: text("kind", { enum: ["receipt", "quote", "statement", "tax", "other"] }).notNull().default("receipt"),
    textContent: text("text_content"),
    extractedJson: text("extracted_json"),
    status: text("status", { enum: ["new", "needs_info", "matched", "reviewed"] }).notNull().default("new"),
    transactionId: text("transaction_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("documents_space_idx").on(t.spaceId, t.createdAt)],
);

export const actions = sqliteTable(
  "actions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: text("status", { enum: ["draft", "approved", "applied", "cancelled", "failed", "reversed"] }).notNull().default("draft"),
    payloadJson: text("payload_json").notNull(),
    previewJson: text("preview_json").notNull(),
    /** Optimistic version of the draft; approval must quote it. */
    version: integer("version").notNull().default(1),
    /** Snapshot of the source records' versions at draft time; rechecked on apply. */
    sourceVersion: text("source_version"),
    idempotencyKey: text("idempotency_key").notNull(),
    resultJson: text("result_json"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    approvedAt: text("approved_at"),
    appliedAt: text("applied_at"),
    reversedAt: text("reversed_at"),
  },
  (t) => [uniqueIndex("actions_idempotency_idx").on(t.idempotencyKey), index("actions_user_idx").on(t.workspaceId, t.userId, t.createdAt)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    actionId: text("action_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("audit_entity_idx").on(t.workspaceId, t.entity, t.entityId)],
);

export const assumptionHistory = sqliteTable(
  "assumption_history",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    json: text("json").notNull(),
    provenance: text("provenance", { enum: ["owner_stated", "demo", "user_edited", "import", "migration"] }).notNull(),
    note: text("note"),
    effectiveFrom: text("effective_from").notNull(),
    supersededAt: text("superseded_at"),
    changedBy: text("changed_by"),
  },
  (t) => [index("assumption_history_ws_idx").on(t.workspaceId, t.effectiveFrom)],
);

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme", { enum: ["system", "light", "dark"] }).notNull().default("system"),
  spokenReplies: integer("spoken_replies", { mode: "boolean" }).notNull().default(false),
  sharePersonalSummary: integer("share_personal_summary", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type User = typeof users.$inferSelect;
export type Person = typeof persons.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type SpacePermission = typeof spacePermissions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Bill = typeof bills.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Scenario = typeof scenarios.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type PurchasePlan = typeof purchasePlans.$inferSelect;
export type ExpenseShare = typeof expenseShares.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type ActionRow = typeof actions.$inferSelect;
export type UserPreferences = typeof userPreferences.$inferSelect;
