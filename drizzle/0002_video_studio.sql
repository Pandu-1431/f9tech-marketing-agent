ALTER TABLE "posts" ADD COLUMN "reel_status" varchar(12) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reel_script" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reel_error" text;