CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"version" integer NOT NULL,
	"decision" varchar(10) NOT NULL,
	"note" text,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"version" integer NOT NULL,
	"reason" varchar(20) NOT NULL,
	"caption" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_prompt" text,
	"poster_headline" varchar(120),
	"poster_cta" varchar(60),
	"poster_asset_id" integer,
	"video_asset_id" integer,
	"demo_parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "current_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "approved_version" integer;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_poster_asset_id_assets_id_fk" FOREIGN KEY ("poster_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_video_asset_id_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_post" ON "approvals" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "approvals_ws" ON "approvals" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_versions_post_version" ON "post_versions" USING btree ("post_id","version");--> statement-breakpoint
CREATE INDEX "post_versions_ws" ON "post_versions" USING btree ("workspace_id");--> statement-breakpoint
-- Backfill (non-destructive): every written post gets version 1 = what it holds today,
-- with its latest poster and video. Posts already approved keep their approval for version 1.
INSERT INTO "post_versions" ("workspace_id", "post_id", "version", "reason", "caption", "hashtags", "image_prompt", "poster_headline", "poster_cta", "poster_asset_id", "video_asset_id", "demo_parts")
SELECT p."workspace_id", p."id", 1, 'backfill', p."caption", p."hashtags", p."image_prompt", p."poster_headline", p."poster_cta",
  (SELECT a."id" FROM "assets" a WHERE a."post_id" = p."id" AND a."kind" = 'poster' ORDER BY a."id" DESC LIMIT 1),
  (SELECT a."id" FROM "assets" a WHERE a."post_id" = p."id" AND a."kind" = 'video' ORDER BY a."id" DESC LIMIT 1),
  p."demo_parts"
FROM "posts" p WHERE p."status" <> 'idea';--> statement-breakpoint
UPDATE "posts" SET "current_version" = 1 WHERE "status" <> 'idea';--> statement-breakpoint
UPDATE "posts" SET "approved_version" = 1 WHERE "status" IN ('approved', 'published');--> statement-breakpoint
INSERT INTO "approvals" ("workspace_id", "post_id", "version", "decision", "note")
SELECT "workspace_id", "id", 1, 'approved', 'Approved before version tracking' FROM "posts" WHERE "status" IN ('approved', 'published');
