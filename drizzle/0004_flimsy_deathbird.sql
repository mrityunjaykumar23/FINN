CREATE TABLE `company_versions` (
	`ticker` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`ticker`) REFERENCES `companies`(`ticker`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `discovery_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`published_at` text,
	`period` text,
	`size_bytes` integer,
	`status` text NOT NULL,
	`detail` text,
	`document_id` text,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`ticker`) REFERENCES `companies`(`ticker`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_url` ON `discovery_candidates` (`ticker`,`url`);--> statement-breakpoint
CREATE INDEX `candidate_status` ON `discovery_candidates` (`ticker`,`status`);--> statement-breakpoint
CREATE TABLE `extraction_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `announcements` ADD `event_signature` text;--> statement-breakpoint
ALTER TABLE `announcements` ADD `exchange_filing_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `announcements_event_identity` ON `announcements` (`ticker`,`document_id`,`event_signature`);--> statement-breakpoint
CREATE INDEX `announcements_page_order` ON `announcements` (`date`,`id`);--> statement-breakpoint
ALTER TABLE `financial_metrics` ADD `reporting_status` text DEFAULT 'reported' NOT NULL;--> statement-breakpoint
ALTER TABLE `source_sync` ADD `cursor` text;--> statement-breakpoint
ALTER TABLE `source_sync` ADD `discovered` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_sync` ADD `inserted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_sync` ADD `duplicates` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO company_versions(ticker,revision) SELECT ticker,0 FROM companies;
--> statement-breakpoint
UPDATE announcements SET event_signature='legacy:' || id WHERE event_signature IS NULL;
--> statement-breakpoint
CREATE TRIGGER revision_documents_insert AFTER INSERT ON documents
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (NEW.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_documents_update AFTER UPDATE ON documents
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (NEW.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_documents_delete AFTER DELETE ON documents
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (OLD.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_document_chunks_insert AFTER INSERT ON document_chunks
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (NEW.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_document_chunks_update AFTER UPDATE ON document_chunks
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (NEW.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_document_chunks_delete AFTER DELETE ON document_chunks
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (OLD.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_financial_metrics_insert AFTER INSERT ON financial_metrics
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (NEW.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_financial_metrics_update AFTER UPDATE ON financial_metrics
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (NEW.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_financial_metrics_delete AFTER DELETE ON financial_metrics
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (OLD.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_guidance_statements_insert AFTER INSERT ON guidance_statements
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (NEW.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_guidance_statements_update AFTER UPDATE ON guidance_statements
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (NEW.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_guidance_statements_delete AFTER DELETE ON guidance_statements
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (OLD.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_metric_derivations_insert AFTER INSERT ON metric_derivations
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (NEW.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_metric_derivations_update AFTER UPDATE ON metric_derivations
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (NEW.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
--> statement-breakpoint
CREATE TRIGGER revision_metric_derivations_delete AFTER DELETE ON metric_derivations
BEGIN
 INSERT INTO company_versions(ticker,revision) VALUES (OLD.ticker,1)
 ON CONFLICT(ticker) DO UPDATE SET revision=revision+1;
END;
