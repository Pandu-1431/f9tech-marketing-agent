CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(80) NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "login_attempts_key" ON "login_attempts" USING btree ("key");