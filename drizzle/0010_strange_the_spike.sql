CREATE TABLE `tick_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ran_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`extracted` integer NOT NULL,
	`stories_upserted` integer NOT NULL,
	`signals_observed` integer NOT NULL,
	`skipped` text NOT NULL,
	`failed` text NOT NULL,
	`signals_skipped` text NOT NULL,
	`signals_failed` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tick_reports_ran_at_idx` ON `tick_reports` (`ran_at`);