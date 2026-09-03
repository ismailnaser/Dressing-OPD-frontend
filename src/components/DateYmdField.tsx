"use client";

import { useRef } from "react";
import { formatYmdDisplay } from "@/lib/clinicDate";

export function DateYmdField({
  value,
  onChange,
  max,
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  max?: string;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  function openPicker() {
    const el = ref.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  }

  return (
    <div className={className ?? "text-xs font-medium text-zinc-600 dark:text-zinc-400"}>
      {label ? <div>{label}</div> : null}
      <button
        type="button"
        onClick={openPicker}
        className="mt-1 flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-left text-sm font-medium tabular-nums text-zinc-900 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
        aria-label={label ? `${label}: ${formatYmdDisplay(value)}` : formatYmdDisplay(value)}
      >
        <span dir="ltr">{formatYmdDisplay(value) || "Select date"}</span>
      </button>
      <input
        ref={ref}
        type="date"
        lang="en-CA"
        dir="ltr"
        value={value}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      />
    </div>
  );
}
