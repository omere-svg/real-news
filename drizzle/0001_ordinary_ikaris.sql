CREATE TABLE `membership` (
	`story_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	PRIMARY KEY(`source`, `external_id`),
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `membership_story_idx` ON `membership` (`story_id`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`region` text NOT NULL,
	`topic` text NOT NULL,
	`significance` real NOT NULL,
	`why_it_matters` text,
	`first_seen_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
