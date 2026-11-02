CREATE TABLE `document_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`official_host` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry` text,
	`error` text,
	`document_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ticker`) REFERENCES `companies`(`ticker`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_job_url` ON `document_jobs` (`ticker`,`url`);--> statement-breakpoint
CREATE INDEX `document_job_pending` ON `document_jobs` (`status`,`next_retry`);--> statement-breakpoint
ALTER TABLE `discovery_candidates` ADD `provider` text DEFAULT 'original_link_directory' NOT NULL;--> statement-breakpoint
ALTER TABLE `discovery_candidates` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `discovery_candidates` ADD `publication_precision` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `discovery_candidates` ADD `publication_timezone` text;--> statement-breakpoint
ALTER TABLE `discovery_candidates` ADD `verification_status` text DEFAULT 'candidate' NOT NULL;--> statement-breakpoint
ALTER TABLE `discovery_candidates` ADD `processing_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `discovery_candidates` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `discovery_candidates` ADD `next_retry` text;--> statement-breakpoint
CREATE INDEX `candidate_processing` ON `discovery_candidates` (`ticker`,`provider`,`processing_status`,`published_at`);--> statement-breakpoint
ALTER TABLE `ingestion_runs` ADD `details` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `source_sync` ADD `manual_required` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_sync` ADD `failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_sync` ADD `pending` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_sync` ADD `discovery_cursor` text;--> statement-breakpoint
ALTER TABLE `source_sync` ADD `details` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
UPDATE discovery_candidates SET provider='official_html_table',verification_status='official_page',publication_precision='date',publication_timezone='Asia/Kolkata' WHERE ticker='NTPC.NS' AND published_at IS NOT NULL AND url LIKE 'https://ntpc.co.in/%';
--> statement-breakpoint
UPDATE discovery_candidates SET processing_status='imported' WHERE EXISTS (SELECT 1 FROM announcements a WHERE a.document_id=discovery_candidates.document_id);
--> statement-breakpoint
UPDATE discovery_candidates SET processing_status='review' WHERE published_at IS NULL;
