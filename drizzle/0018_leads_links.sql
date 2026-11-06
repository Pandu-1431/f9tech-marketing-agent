ALTER TABLE "brands" ADD COLUMN "lead_code" varchar(16);--> statement-breakpoint
CREATE UNIQUE INDEX "brands_lead_code" ON "brands" USING btree ("lead_code");--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(30),
	"email" varchar(160),
	"message" text,
	"source" varchar(60) DEFAULT 'enquiry page' NOT NULL,
	"post_id" integer,
	"status" varchar(12) DEFAULT 'new' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"post_id" integer,
	"campaign_id" integer,
	"platform" varchar(30) NOT NULL,
	"code" varchar(16) NOT NULL,
	"target" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"last_click_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_clicks" (
	"id" serial PRIMARY KEY NOT NULL,
	"link_id" integer NOT NULL,
	"workspace_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_ws_status" ON "leads" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "leads_brand" ON "leads" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "links_code" ON "links" USING btree ("code");--> statement-breakpoint
CREATE INDEX "links_post" ON "links" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "link_clicks_ws_at" ON "link_clicks" USING btree ("workspace_id","at");
