import { useId, type ReactNode } from 'react';
import { PLATFORMS, type Platform } from '../../shared/video';
import { PLATFORM_LABEL, REGIONS, SORT_KEYS, SORT_LABEL, TIME_WINDOWS, TIME_WINDOW_LABEL, type SortKey, type TimeWindow } from '../config';
import type { ViewState } from '../lib/viewState';
import { CheckIcon, PlatformGlyph } from './icons';
import { PLATFORM_BG } from './PlatformBadge';
import { focusRing, selectBase } from './ui';

type Props = {
  view: ViewState;
  onChange: (patch: Partial<ViewState>, opts?: { replace?: boolean }) => void;
};

function PlatformToggles({ selected, onChange }: { selected: Platform[]; onChange: (p: Platform[]) => void }) {
  return (
    <div role="group" aria-label="Platforms" className="flex flex-wrap gap-2">
      {PLATFORMS.map((p) => {
        const on = selected.includes(p);
        const last = on && selected.length === 1;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            aria-disabled={last || undefined}
            title={last ? 'At least one platform must stay on' : undefined}
            onClick={() => {
              if (last) return;
              onChange(on ? selected.filter((x) => x !== p) : PLATFORMS.filter((x) => x === p || selected.includes(x)));
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium motion-safe:transition ${focusRing} ${
              on ? `border-transparent text-white ${PLATFORM_BG[p]}` : 'border-line bg-surface text-muted hover:text-ink'
            } ${last ? 'cursor-not-allowed' : ''}`}
          >
            {on ? <CheckIcon className="size-3.5" /> : <PlatformGlyph platform={p} className="size-3.5" />}
            {PLATFORM_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, id, children, className = '' }: { label: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

export function FilterBar({ view, onChange }: Props) {
  const id = useId();
  const trending = !view.q;
  const regionKnown = REGIONS.some((r) => r.code === view.region);

  return (
    <section aria-label="Filters" className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <PlatformToggles selected={view.platforms} onChange={(platforms) => onChange({ platforms })} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-none">
        <Field label="Posted" id={`${id}-window`} className="lg:w-36">
          <select
            id={`${id}-window`}
            value={trending ? 'all' : view.window}
            disabled={trending}
            title={trending ? 'Trending feeds have no time filter' : undefined}
            onChange={(e) => onChange({ window: e.target.value as TimeWindow })}
            className={selectBase}
          >
            {TIME_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {TIME_WINDOW_LABEL[w]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Region" id={`${id}-region`} className="lg:w-40">
          <select
            id={`${id}-region`}
            value={view.region}
            onChange={(e) => onChange({ region: e.target.value })}
            className={selectBase}
          >
            {!regionKnown && <option value={view.region}>{view.region}</option>}
            {REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Sort by" id={`${id}-sort`} className="col-span-2 sm:col-span-1 lg:w-40">
          <select
            id={`${id}-sort`}
            value={view.sort}
            onChange={(e) => onChange({ sort: e.target.value as SortKey }, { replace: true })}
            className={selectBase}
          >
            {SORT_KEYS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </section>
  );
}
