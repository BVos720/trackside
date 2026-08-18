CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`circuit_id` text NOT NULL,
	`name` text NOT NULL,
	`dates` text,
	`notes` text,
	`spot_ids` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`circuit_id`) REFERENCES `circuits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_circuit` ON `events` (`circuit_id`);