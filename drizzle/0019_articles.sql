CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"topic" varchar(200) NOT NULL,
	"keyword" varchar(120),
	"title" varchar(200),
	"slug" varchar(120),
	"meta_description" varchar(200),
	"body" text,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cover_key" text,
	"words" integer DEFAULT 0 NOT NULL,
	"status" varchar(12) DEFAULT 'writing' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_brand" ON "articles" USING btree ("workspace_id","brand_id");
