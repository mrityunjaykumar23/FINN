CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`payload` text NOT NULL,
	`triggered_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`hash` text NOT NULL,
	`document_id` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `announcements_hash_unique` ON `announcements` (`hash`);--> statement-breakpoint
CREATE TABLE `analysis_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`ticker` text NOT NULL,
	`page` integer NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`ticker` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sector` text NOT NULL,
	`validation` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`period` text NOT NULL,
	`url` text NOT NULL,
	`published_at` text,
	`retrieved_at` text NOT NULL,
	`hash` text NOT NULL,
	`mode` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_hash_unique` ON `documents` (`hash`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `financial_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`name` text NOT NULL,
	`value` real,
	`period` text NOT NULL,
	`unit` text NOT NULL,
	`basis` text NOT NULL,
	`document_id` text NOT NULL,
	`page` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portfolio_companies` (
	`owner` text NOT NULL,
	`ticker` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `ticker`)
);
--> statement-breakpoint
CREATE TABLE `alert_preferences` (
	`owner` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_prices` (
	`ticker` text NOT NULL,
	`date` text NOT NULL,
	`close` real NOT NULL,
	`adjusted_close` real NOT NULL,
	`volume` real NOT NULL,
	`source` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`mode` text NOT NULL,
	PRIMARY KEY(`ticker`, `date`, `mode`)
);
