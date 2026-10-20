import { useId, useState, type FormEvent } from 'react';
import { isSendablePassword } from '../api';
import { LockIcon } from './icons';
import { buttonPrimary, focusRing } from './ui';

type Props = {
  rejected: boolean;
  checking: boolean;
  onSubmit: (password: string) => void;
};

/** Shown when the API answers 401 (APP_PASSWORD gate, PRD §7.4). */
export function PasswordScreen({ rejected, checking, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [invalidChars, setInvalidChars] = useState(false);
  const id = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value === '' || checking) return;
    // The password travels in an HTTP header, which can only carry Latin-1 text.
    if (!isSendablePassword(value)) {
      setInvalidChars(true);
      return;
    }
    onSubmit(value);
  }

  const message = invalidChars
    ? 'The password can only use Latin letters, digits, spaces and common symbols (no emoji or non-Latin scripts).'
    : rejected
      ? 'That password didn’t work. Try again.'
      : null;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand-ink">
            <LockIcon className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">TrendScout is private</h1>
            <p className="text-sm text-muted">Enter the shared password to continue.</p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-sm font-medium">
            Password
          </label>
          <input
            id={id}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setInvalidChars(false);
            }}
            aria-invalid={message !== null || undefined}
            aria-describedby={message !== null ? `${id}-error` : undefined}
            className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink ${message !== null ? 'border-danger-ink' : 'border-line'} ${focusRing}`}
          />
          {message !== null && (
            <p id={`${id}-error`} role="alert" className="text-sm text-danger-ink">
              {message}
            </p>
          )}
        </div>
        <button type="submit" className={buttonPrimary} disabled={checking || value === ''}>
          {checking ? 'Checking…' : 'Unlock'}
        </button>
        <p className="text-xs text-muted">The password is kept only for this browser tab.</p>
      </form>
    </main>
  );
}
