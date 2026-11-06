ALTER TABLE "brands" ADD COLUMN "community_last_run_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"publication_id" integer,
	"post_id" integer,
	"platform" varchar(30) NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"author" varchar(200),
	"text" text NOT NULL,
	"commented_at" timestamp with time zone,
	"intent" varchar(12),
	"reply" text,
	"status" varchar(10) DEFAULT 'new' NOT NULL,
	"error" text,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comments_platform_external" ON "comments" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "comments_ws_status" ON "comments" USING btree ("workspace_id","status");
