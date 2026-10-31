// Merging two save documents (shared/sync-rules.md).

export const SAVE_FORMAT = 1;
export const MAPS = ['items', 'morning', 'evening', 'custom', 'scenes', 'diary', 'xp', 'speech', 'devices', 'memories'];

export class FormatTooNewError extends Error {
  constructor(found) {
    super('format');
    this.found = found;
  }
}

export function pick(x, y) {
  const ux = x.updatedAt || '';
  const uy = y.updatedAt || '';
  if (ux !== uy) return ux > uy ? x : y;
  const bx = x.by || '';
  const by = y.by || '';
  if (bx !== by) return bx > by ? x : y;
  return x;
}

export function merge(a, b) {
  a = a || {};
  b = b || {};
  for (const doc of [a, b]) {
    if ((doc.format ?? SAVE_FORMAT) > SAVE_FORMAT) throw new FormatTooNewError(doc.format);
  }
  const out = {};
  for (const [k, v] of Object.entries(a)) if (!MAPS.includes(k)) out[k] = v;
  for (const [k, v] of Object.entries(b)) if (!MAPS.includes(k) && !(k in out)) out[k] = v;
  out.format = SAVE_FORMAT;
  for (const name of MAPS) {
    const ma = a[name] || {};
    const mb = b[name] || {};
    const m = { ...ma };
    for (const [key, rb] of Object.entries(mb)) {
      m[key] = key in m ? pick(m[key], rb) : rb;
    }
    out[name] = m;
  }
  return out;
}

export function emptySave() {
  return merge({}, {});
}
