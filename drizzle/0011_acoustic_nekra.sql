CREATE TABLE `link_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`chat_id` integer,
	`name` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `link_codes_token_idx` ON `link_codes` (`token`);--> statement-breakpoint
CREATE TABLE `web_sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`chat_id` integer,
	`name` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
