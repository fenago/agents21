// Shared class strings so focus and control styles stay consistent.
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export const buttonBase = `inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${focusRing}`;

export const buttonPrimary = `${buttonBase} bg-brand text-on-brand hover:bg-brand-strong`;

export const buttonSecondary = `${buttonBase} border border-line bg-surface text-ink hover:bg-subtle`;

export const selectBase = `w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
