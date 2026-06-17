CREATE TABLE `usage` (
	`key` text NOT NULL,
	`day` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`key`, `day`)
);
