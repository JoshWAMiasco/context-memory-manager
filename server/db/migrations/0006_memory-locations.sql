CREATE TABLE `memory_locations` (
	`storage_id` text NOT NULL,
	`path` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`storage_id`, `path`),
	FOREIGN KEY (`storage_id`) REFERENCES `storages`(`id`) ON UPDATE no action ON DELETE cascade
);
