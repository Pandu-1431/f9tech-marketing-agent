"use client";

/** Opens the browser's print dialog: choose "Save as PDF". */
export function PrintButton({ label = "Download PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn print:hidden" onClick={() => window.print()}>
      {label}
    </button>
  );
}
