CREATE TABLE `chat_preferences` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`topics` text,
	`regions` text,
	`default_minutes` real
);
