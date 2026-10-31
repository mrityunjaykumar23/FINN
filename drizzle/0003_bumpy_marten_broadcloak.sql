CREATE TABLE `metric_derivations` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`name` text NOT NULL,
	`current_metric_id` text NOT NULL,
	`base_metric_id` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`formula` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ticker`) REFERENCES `companies`(`ticker`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_metric_id`) REFERENCES `financial_metrics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_metric_id`) REFERENCES `financial_metrics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `derivations_inputs_unique` ON `metric_derivations` (`name`,`current_metric_id`,`base_metric_id`);--> statement-breakpoint
ALTER TABLE `documents` ADD `period_status` text DEFAULT 'unverified' NOT NULL;