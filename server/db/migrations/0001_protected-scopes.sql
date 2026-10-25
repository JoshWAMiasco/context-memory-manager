CREATE TABLE `protected_scopes` (
	`storage_id` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`mode` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`storage_id`, `path`),
	FOREIGN KEY (`storage_id`) REFERENCES `storages`(`id`) ON UPDATE no action ON DELETE cascade
);
