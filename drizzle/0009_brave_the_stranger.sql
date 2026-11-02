CREATE TABLE `research_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`ticker` text NOT NULL,
	`question` text NOT NULL,
	`filters` text NOT NULL,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`document_job_id` text,
	`detail` text,
	`result` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticker`) REFERENCES `companies`(`ticker`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_job_id`) REFERENCES `document_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `research_job_owner` ON `research_jobs` (`owner_id`,`updated_at`);