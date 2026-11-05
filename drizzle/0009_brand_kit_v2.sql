ALTER TABLE "brands" ADD COLUMN "visual_style" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "key_facts" text;--> statement-breakpoint
ALTER TABLE "post_versions" ADD COLUMN "poster_subline" varchar(160);--> statement-breakpoint
ALTER TABLE "post_versions" ADD COLUMN "poster_kicker" varchar(40);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "poster_subline" varchar(160);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "poster_kicker" varchar(40);