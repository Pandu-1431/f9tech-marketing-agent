CREATE TABLE "channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"platform" varchar(30) NOT NULL,
	"name" varchar(200) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret" text NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"channel_id" integer,
	"platform" varchar(30) NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"external_id" varchar(200),
	"url" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_ws" ON "channels" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_brand_platform" ON "channels" USING btree ("brand_id","platform");--> statement-breakpoint
CREATE INDEX "publications_ws" ON "publications" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_post_channel_version" ON "publications" USING btree ("post_id","channel_id","version");