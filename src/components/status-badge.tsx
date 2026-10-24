const styles: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  planning: "bg-amber-50 text-amber-700",
  writing: "bg-amber-50 text-amber-700",
  ready: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  idea: "bg-zinc-100 text-zinc-700",
  drafted: "bg-sky-50 text-sky-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  published: "bg-indigo-50 text-indigo-700",
};

const labels: Record<string, string> = {
  planning: "planning…",
  writing: "writing…",
  idea: "writing…",
  drafted: "needs review",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${styles[status] ?? styles.draft}`}>{labels[status] ?? status}</span>;
}
