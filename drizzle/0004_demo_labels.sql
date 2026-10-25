ALTER TABLE "assets" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "demo_parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Backfill (non-destructive): label content that the demo generator already made.
UPDATE "assets" SET "demo" = true WHERE "provider" = 'fake';--> statement-breakpoint
UPDATE "assets" a SET "demo" = true
WHERE a."kind" = 'poster' AND (
  SELECT b."provider" FROM "assets" b
  WHERE b."post_id" = a."post_id" AND b."kind" = 'background' AND b."id" < a."id"
  ORDER BY b."id" DESC LIMIT 1
) = 'fake';--> statement-breakpoint
UPDATE "assets" a SET "demo" = true
WHERE a."kind" = 'video' AND EXISTS (
  SELECT 1 FROM "assets" s WHERE s."post_id" = a."post_id" AND s."kind" = 'scene' AND s."provider" = 'fake' AND s."id" < a."id"
);--> statement-breakpoint
UPDATE "posts" p SET "demo_parts" = "demo_parts" || '["image"]'::jsonb
WHERE (SELECT a."demo" FROM "assets" a WHERE a."post_id" = p."id" AND a."kind" = 'poster' ORDER BY a."id" DESC LIMIT 1) = true;--> statement-breakpoint
UPDATE "posts" p SET "demo_parts" = "demo_parts" || '["video"]'::jsonb
WHERE (SELECT a."demo" FROM "assets" a WHERE a."post_id" = p."id" AND a."kind" = 'video' ORDER BY a."id" DESC LIMIT 1) = true;--> statement-breakpoint
UPDATE "posts" p SET "demo_parts" = "demo_parts" || '["text"]'::jsonb
WHERE p."status" <> 'idea' AND COALESCE(
  (SELECT g."provider" FROM "generations" g
   WHERE g."subject_type" = 'post' AND g."subject_id" = p."id" AND g."purpose" = 'post_copy' AND g."status" = 'ok'
   ORDER BY g."id" DESC LIMIT 1),
  (SELECT g."provider" FROM "generations" g
   WHERE g."subject_type" = 'campaign' AND g."subject_id" = p."campaign_id" AND g."purpose" = 'post_copy_batch' AND g."status" = 'ok'
   ORDER BY g."id" DESC LIMIT 1)
) = 'fake';
