ALTER TABLE "posts" ADD COLUMN "qc_status" varchar(10) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "qc_issues" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "qc_fixes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "qc_checked_at" timestamp with time zone;