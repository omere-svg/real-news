CREATE TABLE `agent_policy` (
	`id` integer PRIMARY KEY NOT NULL,
	`deep_analysis_top_n` integer,
	`reason` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`turns` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_traces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`question` text NOT NULL,
	`steps` text NOT NULL,
	`answered_from_news` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_traces_created_idx` ON `chat_traces` (`created_at`);--> statement-breakpoint
ALTER TABLE `tick_reflections` ADD `actions` text DEFAULT '[]' NOT NULL;