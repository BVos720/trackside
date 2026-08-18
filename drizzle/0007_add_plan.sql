ALTER TABLE `events` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `events` ADD `end_date` text;--> statement-breakpoint
ALTER TABLE `events` ADD `stops` text DEFAULT '[]' NOT NULL;
