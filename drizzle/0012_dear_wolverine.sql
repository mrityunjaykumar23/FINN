CREATE TABLE `metric_processing` (
	`document_id` text NOT NULL,
	`name` text NOT NULL,
	`period` text DEFAULT 'unknown' NOT NULL,
	`basis` text DEFAULT '' NOT NULL,
	`state` text NOT NULL,
	`error_code` text,
	`detail` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`document_id`, `name`, `period`, `basis`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `source_payloads` (
	`document_id` text PRIMARY KEY NOT NULL,
	`format` text NOT NULL,
	`raw` text NOT NULL,
	`payload` text NOT NULL,
	`version` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE `document_jobs` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `document_jobs` ADD `failed_stage` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `source_format` text DEFAULT 'pdf' NOT NULL;--> statement-breakpoint
ALTER TABLE `financial_metrics` ADD `original_value` real;--> statement-breakpoint
ALTER TABLE `financial_metrics` ADD `original_unit` text;--> statement-breakpoint
ALTER TABLE `financial_metrics` ADD `original_currency` text;--> statement-breakpoint
ALTER TABLE `financial_metrics` ADD `original_scale` text;--> statement-breakpoint
ALTER TABLE `financial_metrics` ADD `normalized_value` real;--> statement-breakpoint
ALTER TABLE `financial_metrics` ADD `normalized_unit` text;--> statement-breakpoint
ALTER TABLE `financial_metrics` ADD `evidence_location` text;--> statement-breakpoint
ALTER TABLE `financial_metrics` ADD `period_kind` text;--> statement-breakpoint
ALTER TABLE `financial_metrics` ADD `extraction_context` text;--> statement-breakpoint
ALTER TABLE `daily_prices` ADD `open` real;--> statement-breakpoint
ALTER TABLE `daily_prices` ADD `high` real;--> statement-breakpoint
ALTER TABLE `daily_prices` ADD `low` real;--> statement-breakpoint
ALTER TABLE `daily_prices` ADD `provider` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_prices` ADD `completion_status` text DEFAULT 'legacy_observation' NOT NULL;--> statement-breakpoint
ALTER TABLE `unadjusted_daily_prices` ADD `open` real;--> statement-breakpoint
ALTER TABLE `unadjusted_daily_prices` ADD `high` real;--> statement-breakpoint
ALTER TABLE `unadjusted_daily_prices` ADD `low` real;--> statement-breakpoint
ALTER TABLE `unadjusted_daily_prices` ADD `provider` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `unadjusted_daily_prices` ADD `completion_status` text DEFAULT 'legacy_observation' NOT NULL;