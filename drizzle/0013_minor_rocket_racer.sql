CREATE TABLE `tick_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`locked_until` integer NOT NULL,
	`holder` text
);
