CREATE TABLE "brand_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"kind" varchar(20) NOT NULL,
	"topic" varchar(30) DEFAULT 'note' NOT NULL,
	"text" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" varchar(20) DEFAULT 'analyst' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"publication_id" integer NOT NULL,
	"platform" varchar(30) NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"score" numeric(12, 3) DEFAULT '0' NOT NULL,
	"reads" integer DEFAULT 1 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(40) NOT NULL,
	"task" varchar(10) NOT NULL,
	"rest_until" timestamp with time zone NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "analyst_last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_memory" ADD CONSTRAINT "brand_memory_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_memory" ADD CONSTRAINT "brand_memory_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_memory_ws_brand" ON "brand_memory" USING btree ("workspace_id","brand_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "post_metrics_publication" ON "post_metrics" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "post_metrics_ws_brand" ON "post_metrics" USING btree ("workspace_id","brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_state_provider_task" ON "provider_state" USING btree ("provider","task");