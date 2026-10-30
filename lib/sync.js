// Google sign-in (redirect flow, proven in T1) and Drive appDataFolder sync (shared/sync-rules.md).
import { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, DRIVE_SCOPE } from '../config.js';
import { merge, FormatTooNewError } from './merge.js';
import { load, save, deviceId, now } from './store.js';

const TOKEN_KEY = 'et.token';
const STATE_KEY = 'et.oauthState';
const CONNECTED_KEY = 'et.googleConnected';
const RETURN_KEY = 'et.returnRoute';
const LAST_AUTH_KEY = 'et.lastAuthAttempt';
const LAST_SYNC_KEY = 'et.lastSync';
const FILE_NAME = 'english-talk-save.json';

const status = { state: 'idle', message: '', at: localStorage.getItem(LAST_SYNC_KEY) || '' };
const listeners = new Set();

function setStatus(state, message = '') {
  status.state = state;
  status.message = message;
  if (state === 'done') {
    status.at = now();
    localStorage.setItem(LAST_SYNC_KEY, status.at);
  }
  for (const fn of listeners) fn({ ...status });
}

export const getStatus = () => ({ ...status });
export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const isConnected = () => localStorage.getItem(CONNECTED_KEY) === '1';

function token() {
  const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
  return t && Date.now() < t.expiresAt - 120000 ? t.token : null;
}

export function signIn({ silent = false } = {}) {
  const state = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
  localStorage.setItem(STATE_KEY, state);
  localStorage.setItem(RETURN_KEY, location.hash || '#/');
  localStorage.setItem(LAST_AUTH_KEY, String(Date.now()));
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'token',
    scope: DRIVE_SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (silent) params.set('prompt', 'none');
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CONNECTED_KEY);
  setStatus('idle');
}

// Call once at startup. Returns true when the URL carried an OAuth response (handled here).
export function handleRedirect() {
  const hash = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(hash)) return false;
  const p = new URLSearchParams(hash);
  const back = localStorage.getItem(RETURN_KEY) || '#/';
  history.replaceState(null, '', location.pathname + back);
  if (p.get('state') !== localStorage.getItem(STATE_KEY)) {
    setStatus('error', '로그인 확인에 실패했어요 (보안 값 불일치)');
    return true;
  }
  if (p.get('error')) {
    // interaction_required / login_required after a silent attempt: needs a real sign-in
    setStatus('needs-login', '구글 로그인이 다시 필요해요');
    return true;
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: p.get('access_token'), expiresAt: Date.now() + Number(p.get('expires_in')) * 1000 }));
  localStorage.setItem(CONNECTED_KEY, '1');
  return true;
}

async function drive(path, opts = {}) {
  const t = token();
  if (!t) throw Object.assign(new Error('no token'), { code: 'token' });
  const res = await fetch(`https://www.googleapis.com${path}`, { ...opts, headers: { Authorization: `Bearer ${t}`, ...(opts.headers || {}) } });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    throw Object.assign(new Error('expired'), { code: 'token' });
  }
  if (!res.ok) throw new Error(`Drive ${res.status}`);
  return res;
}

async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await drive(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`);
  return (await res.json()).files[0] || null;
}

async function upload(doc, fileId) {
  const meta = fileId ? {} : { name: FILE_NAME, parents: ['appDataFolder'] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(doc)], { type: 'application/json' }));
  const url = fileId ? `/upload/drive/v3/files/${fileId}?uploadType=multipart` : '/upload/drive/v3/files?uploadType=multipart';
  await drive(url, { method: fileId ? 'PATCH' : 'POST', body: form });
}

let running = null;

// Pull, merge, save locally, push if different (sync-rules.md). Never throws.
export function syncNow() {
  if (running) return running;
  running = (async () => {
    if (!isConnected()) return setStatus('idle');
    if (!navigator.onLine) return setStatus('offline', '인터넷이 연결되면 동기화할게요');
    if (!token()) return setStatus('needs-token');
    setStatus('syncing');
    try {
      const file = await findFile();
      const remote = file ? await (await drive(`/drive/v3/files/${file.id}?alt=media`)).json() : {};
      const merged = merge(load(), remote);
      merged.devices[deviceId()] = { kind: 'phone', lastSync: now(), updatedAt: now(), by: deviceId() };
      save(merged);
      await upload(merged, file?.id);
      setStatus('done');
    } catch (e) {
      if (e instanceof FormatTooNewError) setStatus('error', '게임 쪽 기록이 더 새로운 형식이에요. 폰 앱을 새로고침해 주세요');
      else if (e.code === 'token') setStatus('needs-token');
      else setStatus('error', '동기화하지 못했어요. 다음에 다시 시도할게요');
    } finally {
      running = null;
    }
  })();
  return running;
}

// At app start: sync, renewing the token with a silent redirect when needed (at most once a minute).
export async function syncOnOpen() {
  if (!isConnected()) return;
  if (!token() && navigator.onLine) {
    const last = Number(localStorage.getItem(LAST_AUTH_KEY) || 0);
    if (Date.now() - last > 60000) return signIn({ silent: true });
    return setStatus('needs-login', '구글 로그인이 다시 필요해요');
  }
  await syncNow();
}
