// Scene explanations with the user's own free Gemini API key (Q33 B). The key never leaves this device
// except in requests to Google's Gemini API; it is not synced and not in the repository.

const KEY = 'et.geminiKey';
const MODEL_KEY = 'et.geminiModel';
const API = 'https://generativelanguage.googleapis.com/v1beta';

export const getKey = () => localStorage.getItem(KEY) || '';
export function setKey(key) {
  if (key) localStorage.setItem(KEY, key.trim());
  else localStorage.removeItem(KEY);
  localStorage.removeItem(MODEL_KEY);
}

export class GeminiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'no-key' | 'bad-key' | 'quota' | 'offline' | 'video' | 'failed'
  }
}

async function call(path, body) {
  const key = getKey();
  if (!key) throw new GeminiError('no-key', 'Gemini 키가 없어요');
  if (!navigator.onLine) throw new GeminiError('offline', '인터넷이 연결되면 설명할게요');
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
  const text = await res.text();
  if (res.status === 429) throw new GeminiError('quota', '오늘 무료 사용량을 다 썼거나 너무 빨리 요청했어요. 잠시 뒤에 다시 시도할게요');
  if (res.status === 400 && /API key|API_KEY/i.test(text)) throw new GeminiError('bad-key', 'Gemini 키가 맞지 않아요. 설정에서 다시 넣어 주세요');
  if (res.status === 403) throw new GeminiError('bad-key', 'Gemini 키를 쓸 권한이 없어요. 키 제한 설정을 확인해 주세요');
  throw new GeminiError('failed', `Gemini 오류 ${res.status}: ${text.slice(0, 200)}`);
}

// Picks the newest "flash" model that can generate content (names change over time, so ask the API).
export async function pickModel({ refresh = false } = {}) {
  const cached = localStorage.getItem(MODEL_KEY);
  if (cached && !refresh) return cached;
  const data = await call('models?pageSize=200');
  const flash = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(lite|image|tts|live|audio|thinking)/.test(n));
  const version = (n) => parseFloat(n.match(/^gemini-([\d.]+)/)[1]);
  const byNewest = (list) => list.sort((a, b) => version(b) - version(a) || a.length - b.length);
  const stable = byNewest(flash.filter((n) => !/(exp|preview)/.test(n)));
  const chosen = stable[0] || byNewest(flash)[0] || 'gemini-flash-latest';
  localStorage.setItem(MODEL_KEY, chosen);
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
      ? `첨부한 유튜브 영상의 이 구간 끝부분에서 학습자가 대사를 이해하지 못했어. 실제로 들리는 대사를 받아 적어 줘.`
      : '학습자가 영어 영상을 보다가 이해하지 못한 대사가 있어. 영상은 볼 수 없으니 아래 정보로 가장 그럴듯한 대사를 추정해 줘.',
    scene.heard ? `- 학습자가 들린 대로 적은 말 (정확하지 않을 수 있음): "${scene.heard}"` : '',
    scene.context ? `- 장면 설명: ${scene.context}` : '',
    '1) said_en: 실제 대사 (구간에 여러 문장이 있으면 학습자가 막혔을 만한 마지막 한두 문장)',
    '2) explanation_ko: 뜻과 문맥, 왜 그렇게 말했는지',
    '3) sound_ko: 잘 안 들린 이유 (연음, 축약 등). 특별한 게 없으면 빈 문자열',
    '4) expressions: 외우면 좋을 표현 1~3개 (en, ko, note_ko)',
  ].filter(Boolean).join('\n');
}

async function generate(model, parts) {
  const data = await call(`models/${model}:generateContent`, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
  });
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  try {
    const out = JSON.parse(text);
    out.expressions = (out.expressions || []).filter((e) => e.en && e.ko);
    return out;
  } catch {
    throw new GeminiError('failed', 'Gemini의 답을 읽지 못했어요');
  }
}

// scene: { videoId?, startSec?, heard?, context? } -> { said_en, explanation_ko, sound_ko, expressions, model, mode }
export async function explainScene(scene) {
  const model = await pickModel();
  if (scene.videoId && scene.startSec != null) {
    const end = Math.max(Math.round(scene.startSec), 1);
    const start = Math.max(0, end - 20);
    try {
      const out = await generate(model, [
        { fileData: { fileUri: `https://www.youtube.com/watch?v=${scene.videoId}` }, videoMetadata: { startOffset: `${start}s`, endOffset: `${end + 3}s` } },
        { text: prompt(scene, true) },
      ]);
      return { ...out, model, mode: 'video' };
    } catch (e) {
      if (e.code !== 'failed') throw e; // quota/key/offline: stop; other failures: fall back to text only
    }
  }
  if (!scene.heard && !scene.context) throw new GeminiError('video', '영상을 듣지 못했어요. 들린 단어를 몇 개 적어 주시면 다시 설명할게요');
  const out = await generate(model, [{ text: prompt(scene, false) }]);
  return { ...out, model, mode: 'text' };
}
