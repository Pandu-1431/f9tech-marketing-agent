ALTER TABLE "brands" ADD COLUMN "autopilot_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "autopilot_day" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "autopilot_posts_per_week" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "autopilot_platforms" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "autopilot_formats" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "autopilot_next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "autopilot_last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "source" varchar(20) DEFAULT 'manual' NOT NULL;