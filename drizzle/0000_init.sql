CREATE TABLE `circuit_features` (
	`id` text PRIMARY KEY NOT NULL,
	`circuit_id` text NOT NULL,
	`kind` text NOT NULL,
	`geometry` text NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`circuit_id`) REFERENCES `circuits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_circuit_features_circuit` ON `circuit_features` (`circuit_id`);--> statement-breakpoint
CREATE TABLE `circuits` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`timezone` text NOT NULL,
	`bounds_north` real NOT NULL,
	`bounds_south` real NOT NULL,
	`bounds_east` real NOT NULL,
	`bounds_west` real NOT NULL,
	`centre_latitude` real NOT NULL,
	`centre_longitude` real NOT NULL,
	`layout_variants` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_days` (
	`id` text PRIMARY KEY NOT NULL,
	`circuit_id` text NOT NULL,
	`date` text NOT NULL,
	`source_document_id` text,
	`label` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`circuit_id`) REFERENCES `circuits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_event_days_circuit` ON `event_days` (`circuit_id`);--> statement-breakpoint
CREATE TABLE `marshal_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`circuit_id` text NOT NULL,
	`official_number` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`circuit_id`) REFERENCES `circuits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_marshal_posts_circuit` ON `marshal_posts` (`circuit_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`spot_id` text,
	`type` text NOT NULL,
	`source` text NOT NULL,
	`storage_key` text,
	`external_url` text,
	`reference_kind` text,
	`sort_order` integer NOT NULL,
	`captured_at` text,
	`captured_bearing` real,
	`captured_pitch` real,
	`visibility` text NOT NULL,
	`metadata_stripped` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`spot_id`) REFERENCES `spots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_media_spot` ON `media` (`spot_id`);--> statement-breakpoint
CREATE TABLE `plan_stops` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`spot_id` text NOT NULL,
	`arrival_time` text NOT NULL,
	`departure_time` text NOT NULL,
	`target_session_ids` text NOT NULL,
	`notes` text,
	`sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`spot_id`) REFERENCES `spots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_plan_stops_plan` ON `plan_stops` (`plan_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`event_day_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`visibility` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`event_day_id`) REFERENCES `event_days`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_plans_event_day` ON `plans` (`event_day_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_day_id` text NOT NULL,
	`series_name` text NOT NULL,
	`class_name` text,
	`kind` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`is_night` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`event_day_id`) REFERENCES `event_days`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_event_day` ON `sessions` (`event_day_id`);--> statement-breakpoint
CREATE TABLE `spots` (
	`id` text PRIMARY KEY NOT NULL,
	`circuit_id` text NOT NULL,
	`nearest_marshal_post_id` text,
	`name` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`elevation` real,
	`shooting_bearing` real,
	`access_classification` text NOT NULL,
	`access_notes` text,
	`visibility` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`circuit_id`) REFERENCES `circuits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`nearest_marshal_post_id`) REFERENCES `marshal_posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_spots_circuit` ON `spots` (`circuit_id`);--> statement-breakpoint
CREATE INDEX `idx_spots_marshal_post` ON `spots` (`nearest_marshal_post_id`);--> statement-breakpoint
CREATE INDEX `idx_spots_deleted_at` ON `spots` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `user_spot_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`spot_id` text NOT NULL,
	`user_id` text NOT NULL,
	`personal_notes` text,
	`rating` integer,
	`visibility` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`spot_id`) REFERENCES `spots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_user_spot_notes_spot` ON `user_spot_notes` (`spot_id`);--> statement-breakpoint
CREATE INDEX `idx_user_spot_notes_user` ON `user_spot_notes` (`user_id`);--> statement-breakpoint
CREATE TABLE `walk_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`from_spot_id` text NOT NULL,
	`to_spot_id` text NOT NULL,
	`minutes` real NOT NULL,
	`source` text NOT NULL,
	`derived_from_trace_ids` text NOT NULL,
	`possible_during_live_session` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`from_spot_id`) REFERENCES `spots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_spot_id`) REFERENCES `spots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_walk_edges_from` ON `walk_edges` (`from_spot_id`);--> statement-breakpoint
CREATE INDEX `idx_walk_edges_to` ON `walk_edges` (`to_spot_id`);