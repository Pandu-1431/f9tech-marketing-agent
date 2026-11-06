import type { Brand } from "@/db/schema";
import { removePresenterAction } from "@/app/actions/delete";
import { DeleteButton } from "./delete-button";
import { makePresenterAction, uploadPresenterAction } from "@/app/actions/presenter";
import { publicUrl } from "@/lib/storage";

const MESSAGES: Record<string, { ok: boolean; text: string }> = {
  made: { ok: true, text: "New AI presenter ready. The next presenter video uses this face." },
  uploaded: { ok: true, text: "Photo saved. The next presenter video uses it." },
  "no-ai": { ok: false, text: "No image AI is available right now (free limit or no key). Try again later, or upload a photo." },
  failed: { ok: false, text: "Could not make a presenter. Try again in a minute." },
  "no-file": { ok: false, text: "Choose a photo first." },
  "bad-file": { ok: false, text: "Use a PNG, JPG or WEBP photo under 5 MB." },
};

/*
 * The brand's presenter: one face that appears in every "AI presenter" video, so viewers keep
 * seeing the same person. Made once by the image AI, or a real photo of the owner / staff.
 */
export function PresenterSection({ brand, status }: { brand: Brand; status?: string }) {
  const p = brand.presenter;
  const msg = status ? MESSAGES[status] : undefined;
  return (
    <section id="presenter" className="card scroll-mt-32 space-y-3" data-testid="presenter">
      <div>
        <h2 className="font-semibold">Video presenter</h2>
        <p className="text-sm text-zinc-600">
          The face in your &quot;AI presenter&quot; videos. The same person appears in every video, so viewers get to know them. Use an AI face, or upload a
          real photo of you or your staff (a front-facing photo, chest up, works best).
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        {p ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={publicUrl(p.faceKey)} alt={p.name} className="h-48 w-28 rounded-lg border border-zinc-200 object-cover" />
        ) : (
          <div className="flex h-48 w-28 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-2 text-center text-xs text-zinc-500">
            Made with your first presenter video
          </div>
        )}
        <div className="min-w-[220px] flex-1 space-y-3">
          {p && (
            <p className="text-sm">
              <b>{p.name}</b> <span className="text-zinc-500">({p.source === "upload" ? "your photo" : "AI face"})</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <form action={makePresenterAction.bind(null, brand.id)}>
              <button className="btn-secondary">{p ? "Try another AI face" : "Make an AI presenter"}</button>
            </form>
            {p && <DeleteButton action={removePresenterAction.bind(null, brand.id)} label="Remove presenter" showLabel />}
          </div>
          <form action={uploadPresenterAction.bind(null, brand.id)} className="flex flex-wrap items-center gap-2">
            <input className="input max-w-[140px]" name="name" placeholder="Name (e.g. Ravi)" defaultValue={p?.source === "upload" ? p.name : ""} />
            <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" className="text-sm" />
            <button className="btn-secondary">Use my photo</button>
          </form>
          {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
        </div>
      </div>
    </section>
  );
}
