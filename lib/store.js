// The local save document (shared/save-format.md) in localStorage, plus helpers that stamp records.
import { emptySave, merge } from './merge.js';
import { applyReview } from './srs.js';

const SAVE_KEY = 'et.save';
const DEVICE_KEY = 'et.deviceId';
const listeners = new Set();

export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `phone-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export const now = () => new Date().toISOString();

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function load() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return emptySave();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // corrupt storage: keep a copy so nothing is silently lost
    localStorage.setItem(`${SAVE_KEY}.corrupt.${Date.now()}`, raw);
    return emptySave();
  }
  try {
    return merge(parsed, {});
  } catch {
    return parsed; // newer format than this app knows: never replace it with an empty document
  }
}

export function save(doc) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(doc));
  for (const fn of listeners) fn(doc);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const stamp = (rec) => ({ ...rec, updatedAt: now(), by: deviceId() });

// Mutates a fresh copy and saves it. `fn` receives the document and may change it.
export function update(fn) {
  const doc = load();
  fn(doc);
  save(doc);
  return doc;
}

export function review(doc, id, outcome) {
  const r = applyReview(doc.items[id] ?? null, outcome, today());
  if (r.changed) doc.items[id] = stamp(r.state);
  return r.changed;
}

export function addXp(doc, amount) {
  const key = `${deviceId()}:${today()}`;
  const cur = doc.xp[key]?.amount ?? 0;
  doc.xp[key] = stamp({ amount: cur + amount });
}

export function putRecord(doc, map, key, rec) {
  doc[map][key] = stamp(rec);
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
