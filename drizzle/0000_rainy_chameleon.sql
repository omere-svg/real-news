CREATE TABLE `raw_items` (
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`text` text,
	`published_at` integer,
	`metadata` text NOT NULL,
	PRIMARY KEY(`source`, `external_id`)
);
