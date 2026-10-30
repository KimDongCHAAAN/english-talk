// Review scheduling, daily selection, XP and streak (shared/review-rules.md §1, §2, §4).
// Pure functions: no storage, no clock. Callers pass `today` (local YYYY-MM-DD) and stamp updatedAt/by.

export const INTERVALS = [1, 3, 7, 14, 30, 60]; // days until next review, by box
export const MAX_BOX = 5;
export const REVIEW_CAP = 10;

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// 0 = Sunday ... 6 = Saturday
export function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const isLive = (r) => r && !r.deleted;

function fresh(today) {
  return { box: 0, due: addDays(today, 1), lastReviewed: null, lastOutcome: 'learn', known: false, lapses: 0, reviews: 0 };
}

// Returns { changed, state }. When unchanged, `state` is the input object itself.
export function applyReview(state, outcome, today) {
  const live = isLive(state);
  if (outcome === 'learn') {
    return live ? { changed: false, state } : { changed: true, state: fresh(today) };
  }
  const base = live ? { ...state } : fresh(today);
  delete base.deleted;
  delete base.updatedAt;
  delete base.by;
  const lapses = base.lapses ?? 0;
  const reviews = base.reviews ?? 0;

  if (outcome === 'known') {
    return { changed: true, state: { ...base, box: 4, due: addDays(today, 30), known: true, lastReviewed: today, lastOutcome: 'known', lapses, reviews } };
  }

  const sameDay = live && base.lastReviewed === today;
  const last = base.lastOutcome;
  if (sameDay && last === 'fail') return { changed: false, state };

  if (outcome === 'success') {
    if (sameDay && (last === 'success' || last === 'known')) return { changed: false, state };
    const box = Math.min((base.box ?? 0) + 1, MAX_BOX);
    return { changed: true, state: { ...base, box, due: addDays(today, INTERVALS[box]), lastReviewed: today, lastOutcome: 'success', lapses, reviews: reviews + 1 } };
  }

  if (outcome === 'fail') {
    return { changed: true, state: { ...base, box: 0, due: addDays(today, 1), lastReviewed: today, lastOutcome: 'fail', known: false, lapses: lapses + 1, reviews: reviews + 1 } };
  }
  throw new Error(`unknown outcome: ${outcome}`);
}

export function dueReviews(items, today, cap = REVIEW_CAP) {
  return Object.entries(items || {})
    .filter(([, r]) => isLive(r) && r.due && r.due <= today)
    .sort(([ia, a], [ib, b]) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (a.box ?? 0) - (b.box ?? 0) || (ia < ib ? -1 : ia > ib ? 1 : 0)))
    .slice(0, cap)
    .map(([id]) => id);
}

// order: lesson IDs in study order. Returns { lesson, done }.
export function pickNewLesson(order, morning, today) {
  const m = morning || {};
  const doneToday = order.find((id) => isLive(m[id]) && m[id].date === today);
  if (doneToday) return { lesson: doneToday, done: true };
  const next = order.find((id) => !isLive(m[id]));
  return { lesson: next ?? null, done: false };
}

// Returns { lesson, free }.
export function pickEveningLesson(order, morning, evening) {
  const m = morning || {};
  const e = evening || {};
  let best = null;
  let bestFree = null;
  order.forEach((id, i) => {
    if (!isLive(m[id])) return;
    const cand = { id, date: m[id].date, i };
    const later = (x) => !x || cand.date > x.date || (cand.date === x.date && cand.i > x.i);
    if (!isLive(e[id]) && later(best)) best = cand;
    if (later(bestFree)) bestFree = cand;
  });
  if (best) return { lesson: best.id, free: false };
  if (bestFree) return { lesson: bestFree.id, free: true };
  return { lesson: null, free: false };
}

export function xpTotal(xp) {
  return Object.values(xp || {}).reduce((sum, r) => sum + (isLive(r) ? r.amount || 0 : 0), 0);
}

export function levelForXp(total) {
  let level = 1;
  while (total >= 50 * (level + 1) * level) level += 1;
  return level;
}

export function activeDates(xp) {
  const dates = new Set();
  for (const [key, r] of Object.entries(xp || {})) {
    if (isLive(r) && (r.amount || 0) > 0) dates.add(key.slice(key.lastIndexOf(':') + 1));
  }
  return dates;
}

export function streak(xp, today) {
  const active = activeDates(xp);
  let day = active.has(today) ? today : addDays(today, -1);
  let count = 0;
  for (let guard = 0; guard < 4000; guard += 1) {
    const wd = weekday(day);
    if (wd !== 0 && wd !== 6) {
      if (!active.has(day)) break;
      count += 1;
    }
    day = addDays(day, -1);
  }
  return count;
}
