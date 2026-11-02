CREATE TABLE `document_layouts` (
	`document_id` text NOT NULL,
	`page` integer NOT NULL,
	`payload` text NOT NULL,
	`version` text NOT NULL,
	PRIMARY KEY(`document_id`, `page`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `research_jobs` ADD `purpose` text DEFAULT 'research' NOT NULL;