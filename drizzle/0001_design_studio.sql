CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer,
	"post_id" integer,
	"kind" varchar(20) NOT NULL,
	"storage_key" text NOT NULL,
	"mime" varchar(60) NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer DEFAULT 0 NOT NULL,
	"prompt" text,
	"provider" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "poster_headline" varchar(120);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "poster_cta" varchar(60);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "poster_template" varchar(30) DEFAULT 'band' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "design_status" varchar(12) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "trial_ends_at" timestamp with time zone DEFAULT now() + interval '21 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_ws_kind" ON "assets" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "assets_post" ON "assets" USING btree ("post_id");