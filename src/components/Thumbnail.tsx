import { useState } from 'react';
import type { Platform } from '../../shared/video';
import { PLATFORM_LABEL } from '../config';
import { PlatformGlyph } from './icons';

type Props = { src: string; alt: string; platform: Platform };

/** 9:16 thumbnail, lazy loaded, with a placeholder when missing or broken. */
export function Thumbnail({ src, alt, platform }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const broken = !src || failedSrc === src;

  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden bg-subtle">
      {broken ? (
        <div role="img" aria-label={alt} className="flex size-full flex-col items-center justify-center gap-2 text-muted">
          <PlatformGlyph platform={platform} className="size-8 opacity-70" />
          <span className="text-xs">{PLATFORM_LABEL[platform]} preview unavailable</span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="size-full object-cover"
        />
      )}
    </div>
  );
}
