import type { Brand } from "@/db/schema";
import { runAutopilotNowAction, saveAutopilotAction } from "@/app/actions/autopilot";
import { DAY_NAMES } from "@/agent/autopilot";
import { FORMATS } from "@/agent/planner";
import { PLATFORM_LABELS } from "@/lib/platforms";
import { formatSlot } from "@/lib/schedule";

/** Weekly autopilot settings for one brand (shown on the brand page). */
export function AutopilotForm({ brand }: { brand: Brand }) {
  const platforms = brand.autopilotPlatforms.length ? brand.autopilotPlatforms : brand.platforms;
  const formats = brand.autopilotFormats.length ? brand.autopilotFormats : ["image", "carousel", "reel"];
  return (
    <section className="card space-y-4" data-testid="autopilot">
      <div>
        <h2 className="font-semibold">Weekly autopilot</h2>
        <p className="text-sm text-zinc-600">
          Once a week the AI team picks a theme, plans the posts, writes them, makes posters and reels, and checks them. You only approve.
        </p>
        {brand.autopilotEnabled && brand.autopilotNextRunAt && (
          <p className="mt-1 text-sm text-emerald-700">On · next week is planned {formatSlot(brand.autopilotNextRunAt, brand.timezone)}</p>
        )}
        {brand.autopilotLastRunAt && <p className="text-xs text-zinc-500">Last planned {formatSlot(brand.autopilotLastRunAt, brand.timezone)}</p>}
      </div>
      <form action={saveAutopilotAction.bind(null, brand.id)} className="grid gap-4 md:grid-cols-3">
        <label className="flex items-center gap-2 text-sm font-medium md:col-span-3">
          <input type="checkbox" name="enabled" defaultChecked={brand.autopilotEnabled} /> Turn on weekly autopilot
        </label>
        <div>
          <label className="label" htmlFor="ap-day">Plan the week every</label>
          <select className="input" id="ap-day" name="day" defaultValue={brand.autopilotDay}>
            {DAY_NAMES.map((d, i) => (
              <option key={d} value={i}>{d} (6 am)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ap-n">Posts per week, per platform</label>
          <input className="input" id="ap-n" name="postsPerWeek" type="number" min={1} max={14} defaultValue={brand.autopilotPostsPerWeek} />
        </div>
        <div />
        <fieldset>
          <legend className="label">Platforms</legend>
          <div className="flex flex-wrap gap-3">
            {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="platforms" value={value} defaultChecked={platforms.includes(value)} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="md:col-span-2">
          <legend className="label">Formats</legend>
          <div className="flex flex-wrap gap-3">
            {FORMATS.map((f) => (
              <label key={f} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="formats" value={f} defaultChecked={formats.includes(f)} /> {f}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="md:col-span-3">
          <button className="btn">Save autopilot</button>
        </div>
      </form>
      <form action={runAutopilotNowAction.bind(null, brand.id)} className="border-t border-zinc-100 pt-3">
        <button className="btn-secondary">Plan this week now</button>
        <span className="ml-2 text-xs text-zinc-500">Starts today and covers 7 days. Takes a few minutes; the campaign appears under Campaigns.</span>
      </form>
    </section>
  );
}
