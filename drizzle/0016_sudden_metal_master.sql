ALTER TABLE `chat_traces` ADD `plan` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_traces` ADD `path` text DEFAULT 'agent' NOT NULL;