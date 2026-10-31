// Scene explanations with the user's own free Gemini API key (Q33 B). The key never leaves this device
// except in requests to Google's Gemini API; it is not synced and not in the repository.

const KEY = 'et.geminiKey';
const MODEL_KEY = 'et.geminiModel';
const LITE_KEY = 'et.geminiLiteModel';
const API = 'https://generativelanguage.googleapis.com/v1beta';

export const getKey = () => localStorage.getItem(KEY) || '';
export function setKey(key) {
  if (key) localStorage.setItem(KEY, key.trim());
  else localStorage.removeItem(KEY);
  localStorage.removeItem(MODEL_KEY);
  localStorage.removeItem(LITE_KEY);
}

export class GeminiError extends Error {
  // code: 'no-key' | 'bad-key' | 'quota-minute' | 'quota-day' | 'busy' | 'offline' | 'video' | 'failed'
  constructor(code, message, detail = '') {
    super(message);
    this.code = code;
    this.detail = detail; // Google's own error text, shown small for troubleshooting
  }
}

// Temporary problems: keep the scene waiting and try again later.
export const isTemporary = (e) => ['quota-minute', 'quota-day', 'busy', 'offline', 'no-key'].includes(e.code);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function errorFor(status, text) {
  let msg = text;
  try {
    msg = JSON.parse(text).error?.message || text;
  } catch {
    // not JSON
  }
  const detail = `${status}: ${msg}`.slice(0, 300);
  if (status === 429) {
    const perDay = /per ?day|PerDay|daily/i.test(text);
    return perDay
      ? new GeminiError('quota-day', '오늘 무료 사용량을 다 썼어요. 내일 다시 설명할게요', detail)
      : new GeminiError('quota-minute', '요청이 너무 빨라요. 1분쯤 뒤에 자동으로 다시 시도할게요', detail);
  }
  if ([500, 502, 503, 504].includes(status)) return new GeminiError('busy', '구글 AI 서버가 바빠요. 잠시 뒤에 다시 시도할게요', detail);
  if (status === 400 && /API key|API_KEY/i.test(text)) return new GeminiError('bad-key', 'Gemini 키가 맞지 않아요. 설정에서 다시 넣어 주세요', detail);
  if (status === 403) return new GeminiError('bad-key', 'Gemini 키를 쓸 권한이 없어요. 키 제한 설정을 확인해 주세요', detail);
  return new GeminiError('failed', `Gemini 오류 ${status}`, detail);
}

async function call(path, body) {
  const key = getKey();
  if (!key) throw new GeminiError('no-key', 'Gemini 키가 없어요');
  if (!navigator.onLine) throw new GeminiError('offline', '인터넷이 연결되면 설명할게요');
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(`${API}/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GeminiError('offline', '인터넷 연결을 확인해 주세요');
    }
    if (res.ok) return res.json();
    const err = errorFor(res.status, await res.text());
    if (err.code === 'busy' && attempt < 2) {
      await sleep(attempt === 0 ? 2000 : 6000); // overloaded servers usually recover within seconds
      continue;
    }
    throw err;
  }
}

function newest(names) {
  const version = (n) => parseFloat(n.match(/^gemini-([\d.]+)/)[1]);
  return names.sort((a, b) => version(b) - version(a) || a.length - b.length);
}

// Picks the newest stable "flash" model and the newest "flash-lite" model (names change, so ask the API).
export async function pickModel({ refresh = false } = {}) {
  const cached = localStorage.getItem(MODEL_KEY);
  if (cached && !refresh) return cached;
  const data = await call('models?pageSize=200');
  const names = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(image|tts|live|audio|thinking)/.test(n));
  const stable = (list) => list.filter((n) => !/(exp|preview)/.test(n));
  const flash = names.filter((n) => !/lite/.test(n));
  const lite = names.filter((n) => /lite/.test(n));
  const chosen = newest(stable(flash))[0] || newest(flash)[0] || 'gemini-flash-latest';
  const chosenLite = newest(stable(lite))[0] || newest(lite)[0] || '';
  localStorage.setItem(MODEL_KEY, chosen);
  if (chosenLite) localStorage.setItem(LITE_KEY, chosenLite);
  else localStorage.removeItem(LITE_KEY);
  return chosen;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    said_en: { type: 'STRING', description: 'What was actually said, in correct English' },
    explanation_ko: { type: 'STRING', description: 'Meaning and context, in easy Korean' },
    sound_ko: { type: 'STRING', description: 'Why it was hard to hear (linking, reductions), in Korean. Empty if nothing special' },
    expressions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { en: { type: 'STRING' }, ko: { type: 'STRING' }, note_ko: { type: 'STRING' } },
        required: ['en', 'ko', 'note_ko'],
      },
    },
  },
  required: ['said_en', 'explanation_ko', 'sound_ko', 'expressions'],
};

function prompt(scene, withVideo) {
  return [
    '너는 한국인 영어 회화 초보(CEFR A2)를 돕는 미국 영어 선생님이야. 모든 설명은 쉬운 한국어로 해 줘.',
    withVideo
      ? '첨부한 유튜브 영상의 이 구간 끝부분에서 학습자가 대사를 이해하지 못했어. 실제로 들리는 대사를 받아 적어 줘.'
      : '학습자가 영어 영상을 보다가 이해하지 못한 대사가 있어. 영상은 볼 수 없으니 아래 정보로 가장 그럴듯한 대사를 추정해 줘.',
    scene.title ? `- 영상 제목: ${scene.title}` : '',
    scene.heard ? `- 학습자가 들린 대로 적은 말 (정확하지 않을 수 있음): "${scene.heard}"` : '',
    scene.context ? `- 장면 설명: ${scene.context}` : '',
    '1) said_en: 실제 대사 (구간에 여러 문장이 있으면 학습자가 막혔을 만한 마지막 한두 문장)',
    '2) explanation_ko: 뜻과 문맥, 왜 그렇게 말했는지',
    '3) sound_ko: 잘 안 들린 이유 (연음, 축약 등). 특별한 게 없으면 빈 문자열',
    '4) expressions: 외우면 좋을 표현 1~3개 (en, ko, note_ko)',
  ].filter(Boolean).join('\n');
}

async function generate(model, parts, extraConfig = {}) {
  const data = await call(`models/${model}:generateContent`, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2, ...extraConfig },
  });
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  try {
    const out = JSON.parse(text);
    out.expressions = (out.expressions || []).filter((e) => e.en && e.ko);
    return out;
  } catch {
    throw new GeminiError('failed', 'Gemini의 답을 읽지 못했어요', text.slice(0, 200));
  }
}

// Runs fn(model) with the main model; on a quota error, tries the lighter model once.
async function withFallback(fn) {
  const main = await pickModel();
  try {
    return { out: await fn(main), model: main };
  } catch (e) {
    const lite = localStorage.getItem(LITE_KEY);
    if (!e.code?.startsWith('quota') || !lite || lite === main) throw e;
    return { out: await fn(lite), model: lite };
  }
}

// scene: { videoId?, startSec?, title?, heard?, context? }
// -> { said_en, explanation_ko, sound_ko, expressions, model, mode, videoError? }
export async function explainScene(scene) {
  let videoError = '';
  if (scene.videoId && scene.startSec != null) {
    const end = Math.max(Math.round(scene.startSec), 1);
    const start = Math.max(0, end - 20);
    try {
      const { out, model } = await withFallback((m) => generate(m, [
        // low frame rate + low resolution: we only need the speech, and video frames cost most of the free quota
        { fileData: { fileUri: `https://www.youtube.com/watch?v=${scene.videoId}` }, videoMetadata: { startOffset: `${start}s`, endOffset: `${end + 3}s`, fps: 0.2 } },
        { text: prompt(scene, true) },
      ], { mediaResolution: 'MEDIA_RESOLUTION_LOW' }));
      return { ...out, model, mode: 'video' };
    } catch (e) {
      if (isTemporary(e) || e.code === 'bad-key') throw e;
      videoError = e.detail || e.message; // video listening itself failed: fall back to the typed words
    }
  }
  if (!scene.heard && !scene.context) {
    throw new GeminiError('video', '영상을 듣지 못했어요. 들린 단어를 몇 개 적어 주시면 그걸로 설명할게요', videoError);
  }
  const { out, model } = await withFallback((m) => generate(m, [{ text: prompt(scene, false) }]));
  return { ...out, model, mode: 'text', videoError };
}
