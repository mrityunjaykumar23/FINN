CREATE TABLE `unadjusted_daily_prices` (
	`ticker` text NOT NULL,
	`date` text NOT NULL,
	`close` real NOT NULL,
	`volume` real NOT NULL,
	`source` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`mode` text NOT NULL,
	PRIMARY KEY(`ticker`, `date`, `mode`),
	FOREIGN KEY (`ticker`) REFERENCES `companies`(`ticker`) ON UPDATE no action ON DELETE restrict
);
