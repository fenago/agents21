// Test doubles for the functions layer: in-memory blob store, scripted adapters, video factory.
import type { AdapterResult, PlatformAdapter, SearchOptions, TrendingOptions } from '../../netlify/functions/lib/adapters';
import type { CacheStore } from '../../netlify/functions/lib/cache';
import type { Platform, Video } from '../../shared/video';

export function memoryStore() {
  const data = new Map<string, string>();
  const store: CacheStore & { data: Map<string, string>; gets: number; sets: number } = {
    data,
    gets: 0,
    sets: 0,
    async get(key) {
      store.gets++;
      return data.get(key) ?? null;
    },
    async set(key, value) {
      store.sets++;
      data.set(key, value);
    },
  };
  return store;
}

export function brokenStore(): CacheStore {
  return {
    get: () => Promise.reject(new Error('MissingBlobsEnvironmentError')),
    set: () => {
      throw new Error('MissingBlobsEnvironmentError');
    },
  };
}

export function video(platform: Platform, id: string, overrides: Partial<Video> = {}): Video {
  return {
    platform,
    id,
    url: `https://example.com/${platform}/${id}`,
    thumbnail: `https://cdn.example.com/${platform}/${id}.jpg`,
    title: `${platform} ${id}`,
    author: { handle: 'someone', avatar: 'https://cdn.example.com/a.jpg', url: 'https://example.com/@someone' },
    stats: { views: 100 },
    ...overrides,
  };
}

type Reply = AdapterResult | Error | (() => Promise<AdapterResult>);

/** An adapter whose trending/search answers come from `replies` and records every call. */
export function fakeAdapter(platform: Platform, replies: { trending?: Reply; search?: Reply } = {}) {
  const calls = { trending: [] as (TrendingOptions | undefined)[], search: [] as SearchOptions[] };
  const answer = async (reply: Reply | undefined): Promise<AdapterResult> => {
    if (reply === undefined) return { videos: [video(platform, '1')] };
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply();
    return structuredClone(reply);
  };
  const adapter: PlatformAdapter = {
    platform,
    trending: async (o) => {
      calls.trending.push(o);
      return answer(replies.trending);
    },
    search: async (o) => {
      calls.search.push(o);
      return answer(replies.search);
    },
  };
  return { adapter, calls };
}

export function fakeAdapters(replies: Partial<Record<Platform, { trending?: Reply; search?: Reply }>> = {}) {
  const tiktok = fakeAdapter('tiktok', replies.tiktok);
  const instagram = fakeAdapter('instagram', replies.instagram);
  const youtube = fakeAdapter('youtube', replies.youtube);
  return {
    adapters: { tiktok: tiktok.adapter, instagram: instagram.adapter, youtube: youtube.adapter },
    calls: { tiktok: tiktok.calls, instagram: instagram.calls, youtube: youtube.calls },
  };
}

export function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://trendscout.test${path}`, { headers });
}

export async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
