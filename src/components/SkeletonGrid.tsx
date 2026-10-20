import { GRID_CLASS } from './VideoGrid';

/** Placeholder cards while results load (hidden from assistive tech; status is announced elsewhere). */
export function SkeletonGrid({ count = 10 }: { count?: number }) {
  return (
    <div className={GRID_CLASS} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="aspect-[9/16] w-full bg-subtle motion-safe:animate-pulse" />
          <div className="flex flex-col gap-2 p-3">
            <div className="h-3 w-11/12 rounded bg-subtle motion-safe:animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-subtle motion-safe:animate-pulse" />
            <div className="h-2.5 w-1/3 rounded bg-subtle motion-safe:animate-pulse" />
            <div className="h-2.5 w-3/4 rounded bg-subtle motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
