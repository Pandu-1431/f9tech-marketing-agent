ALTER TABLE "brands" ADD COLUMN "picture_source" varchar(10) DEFAULT 'real' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "source_id" varchar(80);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "credit" text;
