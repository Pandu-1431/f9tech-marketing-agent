import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createBrand } from "@/lib/data";
import { articleHtml, articlePrompt, slugify, startArticle, suggestTopics, writeArticle } from "@/agent/articles";
import { markdownToHtml, wordCount } from "@/lib/markdown";
import { enqueue, processJobs } from "@/jobs/queue";
import { freshDb, makeWorkspace } from "./helpers";

describe("markdown for articles", () => {
  it("turns headings, lists, bold, italic and links into HTML", () => {
    const html = markdownToHtml("Intro line\nsame paragraph\n\n## Why\n- one\n- **two**\n\n1. first\n2. *second*\n\n[Talk to us](https://shop.in/contact)");
    expect(html).toBe(
      [
        "<p>Intro line same paragraph</p>",
        "<h2>Why</h2>",
        "<ul>", "<li>one</li>", "<li><strong>two</strong></li>", "</ul>",
        "<ol>", "<li>first</li>", "<li><em>second</em></li>", "</ol>",
        '<p><a href="https://shop.in/contact">Talk to us</a></p>',
      ].join("\n"),
    );
  });

  it("never lets the article inject HTML or script links", () => {
    const html = markdownToHtml('# Title\n<script>alert(1)</script>\n[x](javascript:alert(1)) <img src=x onerror=1>');
    expect(html).not.toMatch(/<script|<img|href="javascript/);
    expect(html).toContain("&lt;script&gt;");
    expect(html.startsWith("<h2>")).toBe(true); // a stray h1 becomes h2: the page title is the only h1
    expect(wordCount("## Hello world\n- two **words**")).toBe(4);
    expect(slugify("Best Coaching in Vizag? A Guide!")).toBe("best-coaching-in-vizag-a-guide");
  });
});

describe("blog & SEO writer", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("suggests topics from the SEO kit and services, skipping ones already written", () => {
    const brand = {
      services: "Maths coaching\nScience doubts",
      seoKit: {
        keywords: [
          { phrase: "best maths tuition near me", intent: "local" as const, cluster: "tuition" },
          { phrase: "how to score 95 in maths", intent: "learn" as const, cluster: "marks" },
        ],
        hashtagSets: { brand: [], niche: [], local: [], broad: [] },
        questions: ["Is online tuition good for class 10?"],
        suggestions: [],
        generatedAt: "",
      },
    };
    const t = suggestTopics(brand, ["is online tuition good for class 10?"]);
    expect(t).toEqual(["how to score 95 in maths", "Maths coaching: a complete guide", "Science doubts: a complete guide"]);
  });

  it("writes an article with SEO fields, FAQ and a call to action, through the job queue", async () => {
    const { ws } = await makeWorkspace("Blog");
    const brand = await createBrand(ws.id, { name: "Bright Tutors", colors: ["#1d4ed8"], platforms: [], website: "https://brighttutors.in", keyFacts: "First class free" });
    expect(articlePrompt(brand, "How to prepare for board exams", brand.website)).toContain("CALL TO ACTION LINK: https://brighttutors.in");

    const a = await startArticle(ws.id, brand.id, "How to prepare for board exams");
    await enqueue("article.write", { workspaceId: ws.id, articleId: a.id }, ws.id);
    await processJobs(5);
    const db = await getDb();
    const [done] = await db.select().from(schema.articles).where(eq(schema.articles.id, a.id));
    expect(done.status).toBe("ready");
    expect(done.title).toBe("How to prepare for board exams");
    expect(done.slug).toBe("how-to-prepare-for-board-exams");
    expect(done.metaDescription!.length).toBeLessThanOrEqual(155);
    expect(done.words).toBeGreaterThan(50);
    expect(done.body).toContain("[Talk to us](https://brighttutors.in)");
    expect(done.faq.length).toBe(1);

    const full = articleHtml(done, markdownToHtml(done.body!));
    expect(full).toMatch(/^<h1>How to prepare for board exams<\/h1>/);
    expect(full).toContain('"@type":"FAQPage"');
    expect(full).toContain('<a href="https://brighttutors.in">Talk to us</a>');

    await expect(writeArticle(ws.id, 999999)).rejects.toThrow(/not found/);
  });
});
