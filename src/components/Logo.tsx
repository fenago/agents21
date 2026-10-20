import { TrendIcon } from './icons';
import { focusRing } from './ui';

export function Logo({ onHome }: { onHome: () => void }) {
  return (
    <a
      href="/"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onHome();
      }}
      className={`inline-flex shrink-0 items-center gap-2 rounded-lg text-xl font-bold tracking-tight ${focusRing}`}
      aria-label="TrendScout home: trending videos"
    >
      <span className="grid size-8 place-items-center rounded-lg bg-brand text-on-brand">
        <TrendIcon className="size-5" />
      </span>
      <span aria-hidden="true">
        Trend<span className="text-brand-ink">Scout</span>
      </span>
    </a>
  );
}
