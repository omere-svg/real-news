CREATE TABLE `signal_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`key` text NOT NULL,
	`topic` text,
	`value` real NOT NULL,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_obs_key_idx` ON `signal_observations` (`key`,`observed_at`);--> statement-breakpoint
CREATE INDEX `signal_obs_observed_idx` ON `signal_observations` (`observed_at`);--> statement-breakpoint
CREATE TABLE `tick_reflections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`ticks_covered` integer NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tick_reflections_created_idx` ON `tick_reflections` (`created_at`);