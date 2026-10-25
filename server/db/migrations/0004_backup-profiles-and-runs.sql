CREATE TABLE `backup_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_storage_id` text NOT NULL,
	`source_path` text NOT NULL,
	`destination_storage_id` text NOT NULL,
	`destination_path` text NOT NULL,
	`mode` text NOT NULL,
	`compare` text DEFAULT 'size-mtime' NOT NULL,
	`verify` integer DEFAULT false NOT NULL,
	`include_git` integer DEFAULT true NOT NULL,
	`excludes_json` text DEFAULT '[]' NOT NULL,
	`auto_run_on_connect` integer DEFAULT false NOT NULL,
	`auto_resume` integer DEFAULT true NOT NULL,
	`keep_snapshots` integer,
	`last_run_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`profile_id` text,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`source_json` text NOT NULL,
	`destination_json` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`bytes_copied` integer DEFAULT 0 NOT NULL,
	`files_copied` integer DEFAULT 0 NOT NULL,
	`files_skipped` integer DEFAULT 0 NOT NULL,
	`files_deleted` integer DEFAULT 0 NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`message` text,
	`created_by` text,
	FOREIGN KEY (`profile_id`) REFERENCES `backup_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_job_id_unique` ON `backup_runs` (`job_id`);