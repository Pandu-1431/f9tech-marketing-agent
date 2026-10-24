/** Run tasks with at most `limit` running at the same time. Results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);
/** How many AI calls run in parallel. Keep low on free tiers (they limit requests per minute). */
export const parallelism = () => ({
  text: num(process.env.AGENT_TEXT_PARALLEL, 3),
  image: num(process.env.AGENT_IMAGE_PARALLEL, 3),
  postsPerCall: num(process.env.AGENT_POSTS_PER_CALL, 4),
});
