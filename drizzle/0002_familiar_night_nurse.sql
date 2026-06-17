CREATE TABLE `story_vectors` (
	`story_id` text PRIMARY KEY NOT NULL,
	`vector` text NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
