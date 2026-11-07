import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  timestamp,
  date,
  jsonb,
  numeric,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/*
 * Multi-tenant rule: every table that holds customer data has `workspaceId`,
 * and every read/write goes through src/lib/data, which always filters by it.
 */

export type QcIssue = { code: string; level: "fail" | "warn"; message: string; fix?: "rewrite" | "hashtags" };
export type ReelScene = {
  voiceover: string;
  onScreen: string;
  imagePrompt: string;
  /** 1-based product shot to show instead of an AI image. */
  shot?: number;
  /** presenter = the brand's AI presenter talks to camera; text = big words on brand colours; broll = a scene photo. */
  kind?: "presenter" | "broll" | "text";
  /** Concept videos: the step label (e.g. "The problem"). */
  step?: string;
};
/** Marketing Director: what the business wants from marketing. */
export type MarketingObjective = "awareness" | "followers" | "engagement" | "leads" | "traffic" | "installs" | "sales";
export type MarketingGoal = { objective: MarketingObjective; target: string; focus: string; postsPerWeek: number };
export type PlanWeek = { start: string; end: string; theme: string; campaignType: string; callToAction: string; formats: string[]; why: string };
/** The Director's plan for the next four weeks, plus its weekly reviews. */
export type MarketingPlan = {
  summary: string;
  pillars: { name: string; share: number; example: string }[];
  weeks: PlanWeek[];
  kpis: { metric: string; target: string }[];
  reviews: { week: string; at: string; text: string; changes: string[] }[];
  generatedAt: string;
};
/** Video styles: classic slideshow, AI presenter, theme-based, concept explainer, text-only. */
export type ReelStyle = "classic" | "presenter" | "theme" | "concept" | "text";
/** The brand's AI presenter (one face reused in every presenter video), or an uploaded real photo. */
export type Presenter = { faceKey: string; name: string; source: "ai" | "upload" };
export type ReelScript = { title: string; scenes: ReelScene[]; cta: string; voice?: string; durationSec?: number; /** Cover image (thumbnail) for the reel. */ coverKey?: string; style?: ReelStyle; /** Theme videos: one visual look shared by every scene. */ look?: string };

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 200 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  currentWorkspaceId: integer("current_workspace_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// A workspace = one customer account (a business or an agency).
export const workspaces = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  plan: varchar("plan", { length: 30 }).default("free").notNull(),
  country: varchar("country", { length: 2 }).default("IN").notNull(),
  gstin: varchar("gstin", { length: 20 }),
  // Phase 1: every new workspace gets a free trial with all tools.
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).default(sql`now() + interval '21 days'`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).default("editor").notNull(), // owner | editor | client
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("memberships_ws_user").on(t.workspaceId, t.userId)],
);

// Invite link to join a workspace. Only a SHA-256 hash of the token is stored; the link is shown once.
export const invites = pgTable(
  "invites",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).default("client").notNull(), // client | editor
    label: varchar("label", { length: 120 }), // who it is for, e.g. "Ravi (client)" — shown to the owner only
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: integer("accepted_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("invites_ws").on(t.workspaceId)],
);

// A brand = one business account inside a workspace. Its fields are the Brand Kit.
/** Built by src/agent/seo.ts; read by every writing prompt. */
export type SeoKit = {
  keywords: { phrase: string; intent: "learn" | "compare" | "buy" | "local"; cluster: string }[];
  hashtagSets: { brand: string[]; niche: string[]; local: string[]; broad: string[] };
  questions: string[];
  /** Raw suggestions the kit was built from (Google + YouTube autocomplete). */
  suggestions: string[];
  generatedAt: string;
};

export const brands = pgTable(
  "brands",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    industry: varchar("industry", { length: 120 }),
    website: varchar("website", { length: 300 }),
    city: varchar("city", { length: 120 }),
    description: text("description"),
    audience: text("audience"),
    tone: varchar("tone", { length: 200 }),
    language: varchar("language", { length: 60 }).default("English").notNull(),
    colors: jsonb("colors").$type<string[]>().default([]).notNull(),
    fonts: jsonb("fonts").$type<string[]>().default([]).notNull(),
    keywords: jsonb("keywords").$type<string[]>().default([]).notNull(),
    hashtags: jsonb("hashtags").$type<string[]>().default([]).notNull(),
    platforms: jsonb("platforms").$type<string[]>().default([]).notNull(),
    dos: text("dos"),
    donts: text("donts"),
    // What the business sells or does, one per line. The planner spreads posts across them.
    services: text("services"),
    // Posting times are in this zone (IANA name).
    timezone: varchar("timezone", { length: 60 }).default("Asia/Kolkata").notNull(),
    logoUrl: text("logo_url"),
    logoKey: text("logo_key"),
    // Weekly autopilot: every week on this day (0 = Sunday ... 6 = Saturday) the AI team plans and makes the week.
    autopilotEnabled: boolean("autopilot_enabled").default(false).notNull(),
    autopilotDay: integer("autopilot_day").default(1).notNull(),
    autopilotPostsPerWeek: integer("autopilot_posts_per_week").default(5).notNull(),
    autopilotPlatforms: jsonb("autopilot_platforms").$type<string[]>().default([]).notNull(),
    autopilotFormats: jsonb("autopilot_formats").$type<string[]>().default([]).notNull(),
    autopilotNextRunAt: timestamp("autopilot_next_run_at", { withTimezone: true }),
    autopilotLastRunAt: timestamp("autopilot_last_run_at", { withTimezone: true }),
    // Analyst: when post results were last read and turned into learnings (brand_memory).
    analystLastRunAt: timestamp("analyst_last_run_at", { withTimezone: true }),
    // Brand Kit v2. Photo look for every AI image (people, places, mood, banned looks).
    visualStyle: text("visual_style"),
    // Approved facts about the business (numbers, features, dates). The only facts AI may state.
    keyFacts: text("key_facts"),
    // A few of the owner's own past posts: the writers copy this voice.
    voiceSamples: text("voice_samples"),
    // Pictures: "real" = real photos and video clips (Pexels, Pixabay) first, AI pictures when none fit;
    // "ai" = AI pictures first.
    pictureSource: varchar("picture_source", { length: 10 }).default("real").notNull(),
    // SEO kit: keywords people really search + hashtag sets, built from search suggestions (src/agent/seo.ts).
    seoKit: jsonb("seo_kit").$type<SeoKit | null>(),
    presenter: jsonb("presenter").$type<Presenter | null>(),
    // Marketing Director: the goal and the current four-week plan (src/agent/director.ts).
    marketingGoal: jsonb("marketing_goal").$type<MarketingGoal | null>(),
    marketingPlan: jsonb("marketing_plan").$type<MarketingPlan | null>(),
    // Public enquiry page: /l/<leadCode>.
    leadCode: varchar("lead_code", { length: 16 }),
    // Auto-approve: posts that pass the quality check publish without waiting for a person.
    autoApprove: boolean("auto_approve").default(false).notNull(),
    // Community manager: when comments were last read.
    communityLastRunAt: timestamp("community_last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("brands_ws").on(t.workspaceId), uniqueIndex("brands_lead_code").on(t.leadCode)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    theme: varchar("theme", { length: 300 }).notNull(),
    goal: text("goal"),
    platforms: jsonb("platforms").$type<string[]>().notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    postsPerWeek: integer("posts_per_week").default(3).notNull(),
    // Campaign brief. Type picks the planner's story arc (see src/lib/campaign-types.ts).
    campaignType: varchar("campaign_type", { length: 30 }).default("general").notNull(),
    audience: text("audience"),
    // Real facts (venue, timings, numbers, contacts). The only source the AI may take facts from.
    keyFacts: text("key_facts"),
    eventDate: date("event_date"),
    location: varchar("location", { length: 200 }),
    callToAction: varchar("call_to_action", { length: 60 }),
    ctaUrl: varchar("cta_url", { length: 300 }),
    // Empty = the brand's language.
    language: varchar("language", { length: 60 }),
    hashtags: jsonb("hashtags").$type<string[]>().default([]).notNull(),
    formats: jsonb("formats").$type<string[]>().default(["image", "carousel", "reel", "story", "text"]).notNull(),
    // draft | planning | writing | ready | failed
    status: varchar("status", { length: 20 }).default("draft").notNull(),
    // manual = a person made it; autopilot = the weekly autopilot made it.
    source: varchar("source", { length: 20 }).default("manual").notNull(),
    strategy: text("strategy"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("campaigns_ws").on(t.workspaceId)],
);

export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 30 }).notNull(),
    format: varchar("format", { length: 20 }).default("image").notNull(), // image | carousel | reel | story | text
    publishOn: date("publish_on").notNull(), // local date of scheduledAt (kept in sync)
    // When to publish (UTC instant) and the zone the time was chosen in. Not part of the approved content.
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    timezone: varchar("timezone", { length: 60 }).default("Asia/Kolkata").notNull(),
    angle: text("angle"),
    caption: text("caption"),
    hashtags: jsonb("hashtags").$type<string[]>().default([]).notNull(),
    imagePrompt: text("image_prompt"),
    seoKeywords: jsonb("seo_keywords").$type<string[]>().default([]).notNull(),
    // idea | drafted | approved | rejected | published | failed
    status: varchar("status", { length: 20 }).default("idea").notNull(),
    reviewNote: text("review_note"),
    posterHeadline: varchar("poster_headline", { length: 120 }),
    posterCta: varchar("poster_cta", { length: 60 }),
    // Poster sub-line (one short sentence) and kicker (small label above the headline, e.g. "TIP").
    posterSubline: varchar("poster_subline", { length: 160 }),
    posterKicker: varchar("poster_kicker", { length: 40 }),
    posterTemplate: varchar("poster_template", { length: 30 }).default("band").notNull(),
    // none | designing | done | failed
    designStatus: varchar("design_status", { length: 12 }).default("none").notNull(),
    // Video Studio: none | making | done | failed
    reelStatus: varchar("reel_status", { length: 12 }).default("none").notNull(),
    reelScript: jsonb("reel_script").$type<ReelScript | null>(),
    reelError: text("reel_error"),
    // Why the last write/design attempt failed (shown on the card with "Try again"); cleared on success.
    lastError: text("last_error"),
    // Which parts were made by the built-in demo generator (not real AI): "text" | "image" | "video".
    // A post with any demo part cannot be approved.
    demoParts: jsonb("demo_parts").$type<string[]>().default([]).notNull(),
    // Approval lock: every caption or creative change saves a new version (post_versions).
    // Approval is for one version only; any later change sends the post back to review.
    // Quality checker: none | pass | warn | fail, what it found, and how often it rewrote the post itself.
    qcStatus: varchar("qc_status", { length: 10 }).default("none").notNull(),
    qcIssues: jsonb("qc_issues").$type<QcIssue[]>().default([]).notNull(),
    qcFixes: integer("qc_fixes").default(0).notNull(),
    qcCheckedAt: timestamp("qc_checked_at", { withTimezone: true }),
    currentVersion: integer("current_version").default(0).notNull(),
    approvedVersion: integer("approved_version"),
    // The video version a person picked ("Use this"); null = the newest video.
    videoChoice: integer("video_choice"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("posts_ws_status").on(t.workspaceId, t.status),
    index("posts_campaign").on(t.campaignId),
    index("posts_ws_publish_on").on(t.workspaceId, t.publishOn),
  ],
);

// A frozen copy of a post's caption and creative. Publishing (later) uses the approved version.
export const postVersions = pgTable(
  "post_versions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // caption | ai_write | ai_rewrite | poster | reel | backfill
    reason: varchar("reason", { length: 20 }).notNull(),
    caption: text("caption"),
    hashtags: jsonb("hashtags").$type<string[]>().default([]).notNull(),
    imagePrompt: text("image_prompt"),
    posterHeadline: varchar("poster_headline", { length: 120 }),
    posterCta: varchar("poster_cta", { length: 60 }),
    posterSubline: varchar("poster_subline", { length: 160 }),
    posterKicker: varchar("poster_kicker", { length: 40 }),
    posterAssetId: integer("poster_asset_id").references(() => assets.id, { onDelete: "set null" }),
    videoAssetId: integer("video_asset_id").references(() => assets.id, { onDelete: "set null" }),
    demoParts: jsonb("demo_parts").$type<string[]>().default([]).notNull(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }), // null = the agent
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("post_versions_post_version").on(t.postId, t.version), index("post_versions_ws").on(t.workspaceId)],
);

// Approval log: who approved or rejected which version, and when.
export const approvals = pgTable(
  "approvals",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    decision: varchar("decision", { length: 10 }).notNull(), // approved | rejected
    note: text("note"),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }), // null = backfill
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("approvals_post").on(t.postId), index("approvals_ws").on(t.workspaceId)],
);

// Audit trail of every AI call: which model, how long, what it cost.
export const generations = pgTable(
  "generations",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: integer("brand_id").references(() => brands.id, { onDelete: "set null" }),
    subjectType: varchar("subject_type", { length: 30 }),
    subjectId: integer("subject_id"),
    task: varchar("task", { length: 20 }).notNull(), // text | image | video | voice
    purpose: varchar("purpose", { length: 40 }).notNull(), // campaign_plan | post_copy
    provider: varchar("provider", { length: 40 }).notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    prompt: text("prompt").notNull(),
    output: text("output"),
    status: varchar("status", { length: 10 }).notNull(), // ok | failed
    error: text("error"),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).default("0").notNull(),
    durationMs: integer("duration_ms").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("generations_ws_created").on(t.workspaceId, t.createdAt)],
);

// Platform-wide daily request counter per provider, to stay under free-tier caps.
export const providerUsage = pgTable(
  "provider_usage",
  {
    id: serial("id").primaryKey(),
    provider: varchar("provider", { length: 40 }).notNull(),
    day: date("day").notNull(),
    requests: integer("requests").default(0).notNull(),
  },
  (t) => [uniqueIndex("provider_usage_provider_day").on(t.provider, t.day)],
);

// Every file the agent makes or the user uploads (logos, backgrounds, posters, videos, audio).
export const assets = pgTable(
  "assets",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: integer("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    postId: integer("post_id").references(() => posts.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(), // logo | background | poster | video | audio | upload | product_shot | cover
    storageKey: text("storage_key").notNull(),
    mime: varchar("mime", { length: 60 }).notNull(),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes").default(0).notNull(),
    prompt: text("prompt"),
    provider: varchar("provider", { length: 40 }),
    // Videos: which style made it (ReelStyle).
    style: varchar("style", { length: 20 }),
    // Real photos / clips: the source's id ("pexels:123") so a business never gets the same photo twice,
    // and the credit line ("Photo: Ravi K on Pexels").
    sourceId: varchar("source_id", { length: 80 }),
    credit: text("credit"),
    // true = made (fully or partly) by the demo generator; shown with a DEMO label.
    demo: boolean("demo").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("assets_ws_kind").on(t.workspaceId, t.kind), index("assets_post").on(t.postId)],
);

// Simple database job queue (no Redis needed in Phase 1).
export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 40 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 12 }).default("queued").notNull(), // queued | running | done | failed
    attempts: integer("attempts").default(0).notNull(),
    error: text("error"),
    runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("jobs_status_run_after").on(t.status, t.runAfter)],
);

// Failed sign-in counters for throttling. `key` is a SHA-256 hash of "email:<address>"
// or "ip:<address>", so raw emails and IPs are not stored. No passwords are ever stored here.
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 80 }).notNull(),
    failures: integer("failures").default(0).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).defaultNow().notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("login_attempts_key").on(t.key)],
);

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type PostVersion = typeof postVersions.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Invite = typeof invites.$inferSelect;

// A place the agent publishes to: a Telegram channel, a Facebook Page, an Instagram account.
// The token is encrypted (src/lib/secrets.ts) and never sent to the browser.
export const channels = pgTable(
  "channels",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 30 }).notNull(), // telegram | facebook | instagram | youtube | google_business | google_sheets
    name: varchar("name", { length: 200 }).notNull(), // "@chakravyuh_upsc", page name...
    // telegram: { chatId } · facebook: { pageId } · instagram: { igUserId }
    config: jsonb("config").$type<Record<string, string>>().default({}).notNull(),
    secret: text("secret").notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("channels_ws").on(t.workspaceId), uniqueIndex("channels_brand_platform").on(t.brandId, t.platform)],
);

// One approved version of a post sent (or being sent) to one channel. Never sent twice.
export const publications = pgTable(
  "publications",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    channelId: integer("channel_id").references(() => channels.id, { onDelete: "set null" }),
    platform: varchar("platform", { length: 30 }).notNull(),
    version: integer("version").notNull(),
    // queued | sending | sent | failed
    status: varchar("status", { length: 12 }).default("queued").notNull(),
    externalId: varchar("external_id", { length: 200 }),
    url: text("url"),
    error: text("error"),
    attempts: integer("attempts").default(0).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("publications_ws").on(t.workspaceId), uniqueIndex("publications_post_channel_version").on(t.postId, t.channelId, t.version)],
);

export type Channel = typeof channels.$inferSelect;
export type Publication = typeof publications.$inferSelect;

/*
 * Brand memory = what the AI team has learned about ONE brand. Every prompt reads it.
 *   - learning (source analyst): "Reels get 2.4x the engagement of image posts on Instagram (8 posts)".
 *   - feedback (source reviewer): a rejection note from a person, kept as a standing rule.
 *   - fact/preference (source user): a line a person added by hand.
 * `data` keeps the numbers behind a learning (e.g. the best hour per platform) for the planner.
 * Per workspace AND brand, so nothing ever leaks between customers.
 */
export type MemoryTopic = "format" | "platform" | "time" | "template" | "hook" | "length" | "example" | "note";
export const memory = pgTable(
  "brand_memory",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(), // learning | feedback | fact
    topic: varchar("topic", { length: 30 }).default("note").notNull(),
    text: text("text").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
    source: varchar("source", { length: 20 }).default("analyst").notNull(), // analyst | reviewer | user
    // How sure we are (number of posts behind it). Learnings with more evidence come first in prompts.
    weight: integer("weight").default(1).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("brand_memory_ws_brand").on(t.workspaceId, t.brandId, t.active)],
);

// Results of a published post, read back from the platform by the Analyst (one row per publication).
export const postMetrics = pgTable(
  "post_metrics",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    publicationId: integer("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 30 }).notNull(),
    impressions: integer("impressions").default(0).notNull(),
    reach: integer("reach").default(0).notNull(),
    likes: integer("likes").default(0).notNull(),
    comments: integer("comments").default(0).notNull(),
    shares: integer("shares").default(0).notNull(),
    saves: integer("saves").default(0).notNull(),
    views: integer("views").default(0).notNull(),
    clicks: integer("clicks").default(0).notNull(),
    // One number to compare posts with (see src/agent/analyst/score.ts).
    score: numeric("score", { precision: 12, scale: 3 }).default("0").notNull(),
    // How many times the numbers were read (they keep growing for a few days after publishing).
    reads: integer("reads").default(1).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("post_metrics_publication").on(t.publicationId), index("post_metrics_ws_brand").on(t.workspaceId, t.brandId)],
);

// Free-AI rest state (provider out for the day / busy), saved so a restart does not forget it.
export const providerState = pgTable(
  "provider_state",
  {
    id: serial("id").primaryKey(),
    provider: varchar("provider", { length: 40 }).notNull(),
    task: varchar("task", { length: 10 }).notNull(), // text | image | voice
    restUntil: timestamp("rest_until", { withTimezone: true }).notNull(),
    reason: text("reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("provider_state_provider_task").on(t.provider, t.task)],
);

export type BrandMemory = typeof memory.$inferSelect;
export type PostMetric = typeof postMetrics.$inferSelect;

// Leads (CRM): enquiries from the public enquiry page, or added by hand (calls, DMs).
export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 160 }),
    message: text("message"),
    // Where it came from: "enquiry page", a platform ("instagram"), or "manual".
    source: varchar("source", { length: 60 }).default("enquiry page").notNull(),
    postId: integer("post_id"),
    // new | contacted | won | lost
    status: varchar("status", { length: 12 }).default("new").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("leads_ws_status").on(t.workspaceId, t.status), index("leads_brand").on(t.brandId)],
);

// Tracking links: /r/<code> counts a click, then sends the visitor to the target (with UTM tags).
export const links = pgTable(
  "links",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    postId: integer("post_id"),
    campaignId: integer("campaign_id"),
    platform: varchar("platform", { length: 30 }).notNull(),
    code: varchar("code", { length: 16 }).notNull(),
    target: text("target").notNull(),
    clicks: integer("clicks").default(0).notNull(),
    lastClickAt: timestamp("last_click_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("links_code").on(t.code), index("links_post").on(t.postId)],
);

export const linkClicks = pgTable(
  "link_clicks",
  {
    id: serial("id").primaryKey(),
    linkId: integer("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("link_clicks_ws_at").on(t.workspaceId, t.at)],
);

export type Lead = typeof leads.$inferSelect;
export type TrackingLink = typeof links.$inferSelect;

// Blog & SEO writer: website articles built from the brand's SEO kit (src/agent/articles.ts).
export const articles = pgTable(
  "articles",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    topic: varchar("topic", { length: 200 }).notNull(),
    keyword: varchar("keyword", { length: 120 }),
    title: varchar("title", { length: 200 }),
    slug: varchar("slug", { length: 120 }),
    metaDescription: varchar("meta_description", { length: 200 }),
    body: text("body"),
    faq: jsonb("faq").$type<{ q: string; a: string }[]>().default([]).notNull(),
    coverKey: text("cover_key"),
    words: integer("words").default(0).notNull(),
    // writing | ready | failed
    status: varchar("status", { length: 12 }).default("writing").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("articles_brand").on(t.workspaceId, t.brandId)],
);

export type Article = typeof articles.$inferSelect;

// Community manager inbox: comments on published posts, with the AI's draft reply.
export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    publicationId: integer("publication_id").references(() => publications.id, { onDelete: "set null" }),
    postId: integer("post_id"),
    platform: varchar("platform", { length: 30 }).notNull(),
    externalId: varchar("external_id", { length: 200 }).notNull(),
    author: varchar("author", { length: 200 }),
    text: text("text").notNull(),
    commentedAt: timestamp("commented_at", { withTimezone: true }),
    // question | praise | complaint | spam | other
    intent: varchar("intent", { length: 12 }),
    reply: text("reply"),
    // new (no draft yet) | drafted | sent | skipped | failed
    status: varchar("status", { length: 10 }).default("new").notNull(),
    error: text("error"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("comments_platform_external").on(t.platform, t.externalId), index("comments_ws_status").on(t.workspaceId, t.status)],
);

export type Comment = typeof comments.$inferSelect;
