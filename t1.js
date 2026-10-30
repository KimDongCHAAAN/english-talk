// T1 spike: OAuth implicit redirect flow + Drive appDataFolder read/write.
// Throwaway code to answer: does this work inside the iPhone home-screen app?
import { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, DRIVE_SCOPE } from './config.js';

const TOKEN_KEY = 't1.token';
const STATE_KEY = 't1.state';
const LOG_KEY = 't1.log';
const FILE_NAME = 't1-test.json';

const $ = (id) => document.getElementById(id);
const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
$('mode').textContent = standalone ? '홈 화면 앱' : '일반 브라우저';

function log(msg) {
  const line = `${new Date().toLocaleTimeString()} ${msg}`;
  const all = (sessionStorage.getItem(LOG_KEY) || '') + line + '\n';
  sessionStorage.setItem(LOG_KEY, all);
  $('log').textContent = all;
}
$('log').textContent = sessionStorage.getItem(LOG_KEY) || '';

function startAuth(silent) {
  const state = crypto.randomUUID();
  localStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'token',
    scope: DRIVE_SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (silent) params.set('prompt', 'none');
  log(silent ? '자동 확인 시작…' : '로그인 화면으로 이동…');
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + params);
}

function handleRedirect() {
  if (!location.hash) return;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
  if (p.get('state') !== localStorage.getItem(STATE_KEY)) {
    log('❌ state 불일치 (보안 확인 실패)');
    return;
  }
  if (p.get('error')) {
    log(`❌ 로그인 실패: ${p.get('error')}`);
    return;
  }
  const expiresAt = Date.now() + Number(p.get('expires_in')) * 1000;
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: p.get('access_token'), expiresAt }));
  log(`✅ 로그인 성공 (${Math.round((expiresAt - Date.now()) / 60000)}분 유효)`);
}

function token() {
  const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
  if (!t) { log('⚠️ 로그인 정보 없음. 1번을 먼저 누르세요'); return null; }
  if (Date.now() > t.expiresAt) { log('⚠️ 로그인 만료. 4번(자동 확인)을 누르세요'); return null; }
  return t.token;
}

async function drive(path, opts = {}) {
  const t = token();
  if (!t) return null;
  const res = await fetch('https://www.googleapis.com' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${t}`, ...(opts.headers || {}) },
  });
  if (!res.ok) { log(`❌ 드라이브 오류 ${res.status}: ${await res.text()}`); return null; }
  return res;
}

async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await drive(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`);
  if (!res) return undefined;
  return (await res.json()).files[0] || null;
}

async function writeTest() {
  const existing = await findFile();
  if (existing === undefined) return;
  const body = JSON.stringify({ writtenAt: new Date().toISOString(), from: standalone ? 'iphone-home-screen' : 'browser', ua: navigator.userAgent });
  const meta = existing ? {} : { name: FILE_NAME, parents: ['appDataFolder'] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', new Blob([body], { type: 'application/json' }));
  const url = existing
    ? `/upload/drive/v3/files/${existing.id}?uploadType=multipart`
    : '/upload/drive/v3/files?uploadType=multipart';
  const res = await drive(url, { method: existing ? 'PATCH' : 'POST', body: form });
  if (res) log('✅ 쓰기 성공');
}

async function readTest() {
  const f = await findFile();
  if (f === undefined) return;
  if (!f) { log('⚠️ 아직 저장된 시험 기록이 없음. 2번을 먼저 누르세요'); return; }
  const res = await drive(`/drive/v3/files/${f.id}?alt=media`);
  if (res) log('✅ 읽기 성공: ' + (await res.text()));
}

$('login').onclick = () => startAuth(false);
$('silent').onclick = () => startAuth(true);
$('write').onclick = writeTest;
$('read').onclick = readTest;
$('clear').onclick = () => { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(LOG_KEY); $('log').textContent = ''; log('기기 안의 로그인 정보를 지웠어요'); };

handleRedirect();
