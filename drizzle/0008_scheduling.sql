ALTER TABLE "brands" ADD COLUMN "services" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "timezone" varchar(60) DEFAULT 'Asia/Kolkata' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "timezone" varchar(60) DEFAULT 'Asia/Kolkata' NOT NULL;--> statement-breakpoint
CREATE INDEX "posts_ws_publish_on" ON "posts" USING btree ("workspace_id","publish_on");--> statement-breakpoint
-- Backfill (non-destructive): existing posts get the default time slot of their platform, in IST.
UPDATE "posts" SET "scheduled_at" = (("publish_on"::timestamp + (CASE "platform"
    WHEN 'instagram' THEN time '19:00' WHEN 'facebook' THEN time '13:00' WHEN 'linkedin' THEN time '09:30'
    WHEN 'x' THEN time '12:00' WHEN 'youtube' THEN time '18:00' WHEN 'google_business' THEN time '11:00'
    ELSE time '10:00' END)) AT TIME ZONE 'Asia/Kolkata')
WHERE "scheduled_at" IS NULL;
