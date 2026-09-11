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
    source: text("source", { enum: ["manual", "csv", "seed"] }).notNull().default("manual"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("transactions_space_date_idx").on(t.spaceId, t.date), index("transactions_account_idx").on(t.accountId), index("transactions_hash_idx").on(t.accountId, t.importHash)],
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
