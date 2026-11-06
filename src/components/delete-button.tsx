"use client";

/**
 * A small trash-icon delete button. Simple things delete on one click; pass `confirm` for things
 * worth a second look (a campaign, a lead, media a post still needs) and the browser asks first.
 * Inside another form, pass `inForm` so it submits only to its own action.
 */
export function DeleteButton({
  action,
  confirm,
  label = "Delete",
  showLabel = false,
  inForm = false,
  className = "",
}: {
  action: () => Promise<void>;
  confirm?: string;
  label?: string;
  showLabel?: boolean;
  inForm?: boolean;
  className?: string;
}) {
  const button = (
    <button
      type="submit"
      formAction={inForm ? action : undefined}
      title={label}
      aria-label={label}
      data-testid="delete-button"
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={`inline-flex items-center gap-1 rounded-lg p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 ${className}`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
      </svg>
      {showLabel && <span className="text-xs">{label}</span>}
    </button>
  );
  return inForm ? button : <form action={action}>{button}</form>;
}
