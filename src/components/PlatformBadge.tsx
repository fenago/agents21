import type { Platform } from '../../shared/video';
import { PLATFORM_LABEL } from '../config';
import { PlatformGlyph } from './icons';

export const PLATFORM_BG: Record<Platform, string> = {
  tiktok: 'bg-tiktok',
  instagram: 'bg-instagram',
  youtube: 'bg-youtube',
};

export function PlatformBadge({ platform, className = '' }: { platform: Platform; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-white shadow-sm ring-1 ring-white/25 ${PLATFORM_BG[platform]} ${className}`}
    >
      <PlatformGlyph platform={platform} className="size-3" />
      {PLATFORM_LABEL[platform]}
    </span>
  );
}
