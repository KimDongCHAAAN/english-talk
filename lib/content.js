// Loads learning content (shared/content-format.md) and indexes it.

let cache = null;

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function loadContent() {
  if (cache) return cache;
  const index = await getJson('content/index.json');
  const lessons = [];
  const levels = [];
  for (const lv of index.levels) {
    const packs = await Promise.all(lv.packs.map((p) => getJson(`content/packs/${p}.json`)));
    const lvLessons = packs.flatMap((p) => p.lessons.map((l) => ({ ...l, level: p.level, pack: p.pack })));
    levels.push({ level: lv.level, title_ko: lv.title_ko, lessons: lvLessons.map((l) => l.id) });
    lessons.push(...lvLessons);
  }
  const expressions = new Map();
  const lessonOf = new Map();
  for (const l of lessons) {
    for (const e of l.expressions) {
      expressions.set(e.id, e);
      lessonOf.set(e.id, l.id);
    }
  }
  const [videos, npcs] = await Promise.all([getJson('content/videos.json'), getJson('content/npcs.json')]);
  cache = {
    levels,
    lessons,
    order: lessons.map((l) => l.id),
    lessonById: new Map(lessons.map((l) => [l.id, l])),
    expressions,
    lessonOf,
    videos,
    npcs: new Map(npcs.npcs.map((n) => [n.id, n])),
  };
  return cache;
}

// An expression from content, or a custom one from the save ("c:<uuid>").
export function findExpression(content, doc, id) {
  if (id.startsWith('c:')) {
    const c = doc.custom[id.slice(2)];
    return c && !c.deleted ? { id, en: c.en, ko: c.ko, note_ko: c.note_ko || '', examples: [], custom: true } : null;
  }
  return content.expressions.get(id) || null;
}
