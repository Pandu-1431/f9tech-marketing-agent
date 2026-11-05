ALTER TABLE "posts" ADD COLUMN "last_error" text;--> statement-breakpoint
-- One-time repair: posters left on "Designing…" by an interrupted or failed job.
UPDATE "posts" SET "design_status" = 'failed', "last_error" = 'Interrupted. Click "New image" to try again.' WHERE "design_status" = 'designing';
