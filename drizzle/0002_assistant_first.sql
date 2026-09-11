CREATE TABLE `actions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`payload_json` text NOT NULL,
	`preview_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source_version` text,
	`idempotency_key` text NOT NULL,
	`result_json` text,
	`error` text,
	`created_at` text NOT NULL,
	`approved_at` text,
	`applied_at` text,
	`reversed_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actions_idempotency_idx` ON `actions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `actions_user_idx` ON `actions` (`workspace_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assumption_history` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`json` text NOT NULL,
	`provenance` text NOT NULL,
	`note` text,
	`effective_from` text NOT NULL,
	`superseded_at` text,
	`changed_by` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assumption_history_ws_idx` ON `assumption_history` (`workspace_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`action_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`workspace_id`,`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`space_id` text NOT NULL,
	`uploader_user_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_path` text NOT NULL,
	`kind` text DEFAULT 'receipt' NOT NULL,
	`text_content` text,
	`extracted_json` text,
	`status` text DEFAULT 'new' NOT NULL,
	`transaction_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `documents_space_idx` ON `documents` (`space_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `expense_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`economic_event_id` text NOT NULL,
	`person_id` text NOT NULL,
	`cents` integer NOT NULL,
	`category_id` text,
	`date` text NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `expense_shares_person_idx` ON `expense_shares` (`person_id`,`date`);--> statement-breakpoint
CREATE INDEX `expense_shares_txn_idx` ON `expense_shares` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `purchase_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`payer_space_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`specification` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_cents` integer,
	`tax_shipping_cents` integer,
	`target_month` text,
	`funding_account_id` text,
	`beneficiary` text DEFAULT 'company' NOT NULL,
	`beneficiary_person_id` text,
	`purpose` text DEFAULT 'unresolved' NOT NULL,
	`treatment` text DEFAULT 'review_required' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`quote_document_id` text,
	`notes` text,
	`source` text DEFAULT 'user' NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`funding_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`beneficiary_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `purchase_plans_ws_idx` ON `purchase_plans` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`space_id` text NOT NULL,
	`provider` text NOT NULL,
	`product` text NOT NULL,
	`tier` text,
	`kind` text DEFAULT 'subscription' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_cents` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`interval` text DEFAULT 'monthly' NOT NULL,
	`renewal_date` text,
	`tax_cents` integer,
	`status` text DEFAULT 'planned' NOT NULL,
	`account_status` text DEFAULT 'unknown' NOT NULL,
	`users_json` text DEFAULT '[]' NOT NULL,
	`evidence` text,
	`verified_at` text,
	`cancellation_info` text,
	`notes` text,
	`source` text DEFAULT 'user' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscriptions_ws_idx` ON `subscriptions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`spoken_replies` integer DEFAULT false NOT NULL,
	`share_personal_summary` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `bills` ADD `payer_space_id` text REFERENCES spaces(id);--> statement-breakpoint
ALTER TABLE `bills` ADD `beneficiary` text;--> statement-breakpoint
ALTER TABLE `bills` ADD `purpose` text;--> statement-breakpoint
ALTER TABLE `bills` ADD `treatment` text;--> statement-breakpoint
ALTER TABLE `bills` ADD `source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `budgets` ADD `source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `budgets` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `goals` ADD `source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `goals` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `economic_event_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `beneficiary` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `purpose` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `treatment` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `review_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `document_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `payer_person_id` text REFERENCES persons(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `void_reason` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `transactions_event_idx` ON `transactions` (`economic_event_id`);