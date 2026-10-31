// YouTube helpers: link parsing and in-app search (Q35 A) with the site-restricted YouTube Data API key.
import { YOUTUBE_API_KEY } from '../config.js';

export const searchEnabled = () => !!YOUTUBE_API_KEY;

export function videoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(embed|shorts|live)\/([\w-]{6,})/);
    return m ? m[2] : null;
  } catch {
    return /^[\w-]{11}$/.test(url) ? url : null;
  }
}

export function startSeconds(url) {
  try {
    const t = new URL(url).searchParams.get('t') || '';
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(\d+)s?$/);
    return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
  } catch {
    return 0;
  }
}

export const watchUrl = (id, t) => `https://www.youtube.com/watch?v=${id}${t ? `&t=${Math.floor(t)}s` : ''}`;

const decode = (s) => {
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value;
};

// Returns [{ id, title, channel, thumb, published }]. Costs 100 of the daily 10,000 quota units.
export async function search(query, { captionsOnly = true } = {}) {
  const params = new URLSearchParams({
    part: 'snippet', type: 'video', maxResults: '15', q: query, key: YOUTUBE_API_KEY,
    videoEmbeddable: 'true', safeSearch: 'moderate', relevanceLanguage: 'en', regionCode: 'US',
  });
  if (captionsOnly) params.set('videoCaption', 'closedCaption');
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) {
    const quota = res.status === 403 && /quota/i.test(await res.text());
    throw new Error(quota ? '오늘 검색 횟수를 다 썼어요. 내일 다시 검색할 수 있어요' : `검색하지 못했어요 (${res.status})`);
  }
  const data = await res.json();
  return (data.items || []).map((it) => ({
    id: it.id.videoId,
    title: decode(it.snippet.title),
    channel: decode(it.snippet.channelTitle),
    thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || '',
    published: (it.snippet.publishedAt || '').slice(0, 10),
  }));
}
