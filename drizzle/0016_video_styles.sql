ALTER TABLE "brands" ADD COLUMN "presenter" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "video_choice" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "style" varchar(20);
