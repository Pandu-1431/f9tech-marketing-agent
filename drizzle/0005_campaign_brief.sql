ALTER TABLE "campaigns" ADD COLUMN "campaign_type" varchar(30) DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "key_facts" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "event_date" date;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "location" varchar(200);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "call_to_action" varchar(60);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cta_url" varchar(300);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "language" varchar(60);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "formats" jsonb DEFAULT '["image","carousel","reel","story","text"]'::jsonb NOT NULL;