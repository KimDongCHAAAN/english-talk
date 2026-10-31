// Phone web app (spec §3 commute flow, §6 scenes, §4.3 videos, §9.1). Hash routes, one render() per route.
import { loadContent, findExpression } from './lib/content.js';
import { load, update, review, addXp, putRecord, today, uuid, onChange } from './lib/store.js';
import { dueReviews, pickNewLesson, xpTotal, levelForXp, streak } from './lib/srs.js';
import * as speech from './lib/speech.js';
import * as sync from './lib/sync.js';
import * as youtube from './lib/youtube.js';

export const APP_VERSION = '2026-11-01.1'; // keep in sync with CACHE in sw.js
const XP = { morning: 20, review: 2 };
const app = document.getElementById('app');
let content = null;
let session = null; // the running lesson/review/quiz

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const go = (hash) => { location.hash = hash; };
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

function routeParts() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

function speakBtn(text, label = '🔊') {
  return `<button class="icon" data-say="${esc(text)}" aria-label="듣기">${label}</button><button class="icon" data-say-slow="${esc(text)}" aria-label="느리게 듣기">🐢</button>`;
}

function syncChip() {
  const s = sync.getStatus();
  if (!sync.isConnected()) return '<a class="chip" href="#/settings">☁️ 동기화 꺼짐</a>';
  const map = {
    syncing: '⏳ 동기화 중',
    done: '✅ 동기화됨',
    offline: '📴 오프라인',
    error: '⚠️ 동기화 실패',
    'needs-login': '🔑 로그인 필요',
    'needs-token': '🔑 확인 필요',
    idle: '☁️ 동기화',
  };
  return `<a class="chip" href="#/settings">${map[s.state] || '☁️'}</a>`;
}

function header(title, back = '#/') {
  return `<header class="bar">${back ? `<a class="back" href="${back}">‹</a>` : '<span></span>'}<h1>${esc(title)}</h1>${syncChip()}</header>`;
}

function learnedIds(doc) {
  return Object.entries(doc.items).filter(([, r]) => r && !r.deleted).map(([id]) => id);
}

// ---------- home ----------

function renderHome() {
  const doc = load();
  const t = today();
  const pick = pickNewLesson(content.order, doc.morning, t);
  const lesson = pick.lesson ? content.lessonById.get(pick.lesson) : null;
  const due = dueReviews(doc.items, t);
  const xp = xpTotal(doc.xp);
  const lv = levelForXp(xp);
  const lvStart = 50 * lv * (lv - 1);
  const lvNext = 50 * (lv + 1) * lv;
  const pct = Math.round(((xp - lvStart) / (lvNext - lvStart)) * 100);
  const learned = learnedIds(doc).length;
  const lessonsDone = content.order.filter((id) => doc.morning[id] && !doc.morning[id].deleted).length;
  const level1 = content.levels[0];
  const quest = lesson?.quest;
  const npc = quest ? content.npcs.get(quest.npc) : null;

  let todayCard;
  if (!lesson) {
    todayCard = `<div class="card"><h2>🎉 준비된 레슨을 모두 마쳤어요</h2><p>새 레슨이 곧 추가돼요. 그동안 복습과 퀴즈로 다져요.</p></div>`;
  } else if (pick.done) {
    todayCard = `<div class="card done"><h2>✅ 오늘의 표현 완료</h2><p>${esc(lesson.title_ko)}</p>
      <a class="btn secondary" href="#/lesson/${lesson.id}">다시 보기</a></div>`;
  } else {
    todayCard = `<div class="card"><h2>오늘의 표현 5개</h2><p>${esc(lesson.title_ko)}</p>
      <a class="btn primary big" href="#/learn">시작하기</a></div>`;
  }

  app.innerHTML = `
    ${header('english-talk', '')}
    <section class="card hero">
      <div class="avatar">🧑‍💼</div>
      <div class="grow">
        <div class="row"><b>Lv.${lv}</b><span class="muted">New Harbor 주민</span></div>
        <div class="xpbar"><span style="width:${pct}%"></span></div>
        <div class="row small"><span>경험치 ${xp - lvStart} / ${lvNext - lvStart}</span><span>🔥 평일 연속 ${streak(doc.xp, t)}일</span></div>
      </div>
    </section>
    ${todayCard}
    <a class="card link" href="#/review"><h2>🔁 복습 ${due.length}개</h2><p>${due.length ? '잊어버리기 전에 다시 볼 차례예요' : '오늘 복습할 표현이 없어요'}</p></a>
    ${quest ? `<div class="card quest"><h2>🎯 오늘 저녁 퀘스트</h2><p>${esc(quest.goal_ko)}</p><p class="small muted">${esc(npc?.name || '')} · 저녁에 컴퓨터 게임에서</p></div>` : ''}
    <div class="grid">
      <a class="tile" href="#/quiz">🎧<span>듣기 퀴즈</span></a>
      <a class="tile" href="#/scenes">🙋<span>이해 못 한 장면</span></a>
      <a class="tile" href="#/videos">📺<span>영상 보기</span></a>
      <a class="tile" href="#/learned">📚<span>배운 표현 ${learned}</span></a>
    </div>
    <div class="card small muted">레벨 ${level1.level} · ${esc(level1.title_ko)} · 레슨 ${lessonsDone}/${level1.lessons.length}</div>
    <footer class="small muted"><a href="#/settings">설정</a> · <a href="privacy.html">개인정보처리방침</a> · <a href="terms.html">서비스 약관</a></footer>`;
}

// ---------- lesson + review session ----------

function startLearn() {
  const doc = load();
  const t = today();
  const pick = pickNewLesson(content.order, doc.morning, t);
  if (!pick.lesson || pick.done) return go('#/review');
  const lesson = content.lessonById.get(pick.lesson);
  const steps = lesson.expressions.map((e) => ({ type: 'new', id: e.id }));
  const due = dueReviews(doc.items, t).filter((id) => !lesson.expressions.some((e) => e.id === id));
  steps.push(...due.map((id) => ({ type: 'review', id })));
  session = { kind: 'learn', lessonId: lesson.id, steps, i: 0, reveal: false, stats: { known: 0, ok: 0, miss: 0 } };
  renderSession();
}

function startReview() {
  const doc = load();
  const steps = dueReviews(doc.items, today()).map((id) => ({ type: 'review', id }));
  session = { kind: 'review', steps, i: 0, reveal: false, stats: { known: 0, ok: 0, miss: 0 } };
  renderSession();
}

function exprCard(e, { showAll = true } = {}) {
  const examples = (e.examples || [])
    .map((x) => `<li class="ex"><div class="grow"><div>${esc(x.en)}</div><div class="muted">${esc(x.ko)}</div></div><div class="btns">${speakBtn(x.en)}</div></li>`)
    .join('');
  return `<div class="expr">
      <div class="en">${esc(e.en)}</div>
      <div class="say">${speakBtn(e.en)}</div>
      ${showAll ? `<div class="ko">${esc(e.ko)}</div>
      ${e.note_ko ? `<p class="note">${esc(e.note_ko)}</p>` : ''}
      ${examples ? `<ul class="examples">${examples}</ul>` : ''}` : ''}
    </div>`;
}

function renderSession() {
  const s = session;
  if (!s) return go('#/');
  const doc = load();
  if (s.i >= s.steps.length) return renderSessionEnd();
  const step = s.steps[s.i];
  const e = findExpression(content, doc, step.id);
  if (!e) {
    s.i += 1;
    return renderSession();
  }
  const progress = `<div class="progress"><span style="width:${(s.i / s.steps.length) * 100}%"></span></div>`;
  const title = s.kind === 'learn' && step.type === 'new' ? '오늘의 표현' : '복습';
  let body;
  if (step.type === 'new') {
    body = `${exprCard(e)}
      <div class="actions"><button class="btn secondary" data-act="known">알아요</button><button class="btn primary" data-act="next">다음 →</button></div>
      <p class="small muted center">"알아요"를 누르면 30일 뒤에 한 번만 다시 확인해요</p>`;
  } else if (!s.reveal) {
    body = `<div class="expr"><div class="label">이 뜻을 영어로 떠올려 보세요</div><div class="ko big">${esc(e.ko)}</div></div>
      <div class="actions"><button class="btn primary big" data-act="reveal">정답 보기</button></div>`;
  } else {
    body = `${exprCard(e)}
      <div class="actions"><button class="btn secondary" data-act="miss">헷갈려요</button><button class="btn primary" data-act="ok">기억났어요</button></div>`;
  }
  app.innerHTML = `${header(title)}${progress}<section class="card">${body}</section>
    <p class="small muted center">${s.i + 1} / ${s.steps.length}</p>`;
}

function sessionAction(act) {
  const s = session;
  const step = s.steps[s.i];
  if (act === 'reveal') {
    s.reveal = true;
    renderSession();
    const e = findExpression(content, load(), step.id);
    if (e) speech.speak(e.en);
    return;
  }
  update((doc) => {
    if (act === 'known') {
      review(doc, step.id, 'known');
      s.stats.known += 1;
    } else if (act === 'next') {
      review(doc, step.id, 'learn');
    } else if (act === 'ok' || act === 'miss') {
      if (review(doc, step.id, act === 'ok' ? 'success' : 'fail')) addXp(doc, XP.review);
      s.stats[act] += 1;
    }
    const isLastNew = s.kind === 'learn' && step.type === 'new' && (s.i + 1 >= s.steps.length || s.steps[s.i + 1].type !== 'new');
    if (isLastNew && !(doc.morning[s.lessonId] && !doc.morning[s.lessonId].deleted)) {
      putRecord(doc, 'morning', s.lessonId, { date: today() });
      addXp(doc, XP.morning);
      s.lessonDone = true;
    }
  });
  s.i += 1;
  s.reveal = false;
  renderSession();
  const next = s.steps[s.i];
  if (next && next.type === 'new') {
    const e = findExpression(content, load(), next.id);
    if (e) speech.speak(e.en);
  }
}

function renderSessionEnd() {
  const s = session;
  sync.syncNow();
  const lines = [];
  if (s.lessonDone) lines.push('✅ 오늘의 표현 5개를 익혔어요 (+20 경험치)');
  if (s.stats.ok || s.stats.miss) lines.push(`🔁 복습: 기억 ${s.stats.ok}개, 헷갈림 ${s.stats.miss}개`);
  if (s.stats.known) lines.push(`👍 이미 아는 표현 ${s.stats.known}개는 30일 뒤에 확인해요`);
  if (!lines.length) lines.push('오늘은 복습할 표현이 없어요');
  const lesson = s.lessonId ? content.lessonById.get(s.lessonId) : null;
  app.innerHTML = `${header('잘했어요!')}
    <section class="card center"><div class="avatar big">🎉</div>${lines.map((l) => `<p>${l}</p>`).join('')}</section>
    ${lesson ? `<section class="card quest"><h2>🎯 오늘 저녁 퀘스트</h2><p>${esc(lesson.quest.goal_ko)}</p></section>` : ''}
    ${lesson?.videos?.length ? `<a class="btn secondary big" href="#/watch?v=${encodeURIComponent(lesson.videos[0].id)}&t=${lesson.videos[0].start || 0}">📺 이 레슨 영상 보기</a>` : ''}
    <div class="actions"><a class="btn secondary" href="#/quiz">듣기 퀴즈</a><a class="btn primary" href="#/">홈으로</a></div>`;
  session = null;
}

// ---------- lesson re-view and learned list ----------

function renderLessonView(lessonId) {
  const lesson = content.lessonById.get(lessonId);
  if (!lesson) return go('#/');
  app.innerHTML = `${header(lesson.title_ko)}${lesson.expressions.map((e) => `<section class="card">${exprCard(e)}</section>`).join('')}`;
}

function renderLearned() {
  const doc = load();
  const ids = learnedIds(doc);
  const rows = ids
    .map((id) => findExpression(content, doc, id))
    .filter(Boolean)
    .map((e) => `<li class="card row"><div class="grow"><div class="en small-en">${esc(e.en)}</div><div class="muted">${esc(e.ko)}</div></div>${speakBtn(e.en)}</li>`)
    .join('');
  app.innerHTML = `${header('배운 표현')}<ul class="plain">${rows || '<li class="card muted">아직 배운 표현이 없어요</li>'}</ul>`;
}

// ---------- listening quiz (no effect on review schedule) ----------

function startQuiz() {
  const doc = load();
  const pool = learnedIds(doc).map((id) => findExpression(content, doc, id)).filter(Boolean);
  if (pool.length < 4) {
    app.innerHTML = `${header('듣기 퀴즈')}<section class="card"><p>표현을 4개 이상 배우면 퀴즈를 풀 수 있어요.</p><a class="btn primary" href="#/learn">오늘의 표현 배우기</a></section>`;
    return;
  }
  const t = today();
  const todays = pool.filter((e) => content.lessonOf.get(e.id) && doc.morning[content.lessonOf.get(e.id)]?.date === t);
  const questions = shuffle([...new Set([...shuffle(todays), ...shuffle(pool)])]).slice(0, 5).map((answer) => ({
    answer,
    options: shuffle([answer, ...shuffle(pool.filter((p) => p.id !== answer.id)).slice(0, 3)]),
  }));
  session = { kind: 'quiz', questions, i: 0, correct: 0, picked: null };
  renderQuiz();
}

function renderQuiz() {
  const s = session;
  if (s.i >= s.questions.length) {
    app.innerHTML = `${header('듣기 퀴즈')}<section class="card center"><div class="avatar big">🎧</div><p>${s.questions.length}문제 중 ${s.correct}개 맞혔어요!</p></section>
      <div class="actions"><button class="btn secondary" data-act="quiz-again">다시 풀기</button><a class="btn primary" href="#/">홈으로</a></div>`;
    session = null;
    return;
  }
  const q = s.questions[s.i];
  const opts = q.options
    .map((o) => {
      let cls = '';
      if (s.picked) cls = o.id === q.answer.id ? 'right' : o.id === s.picked ? 'wrong' : '';
      return `<button class="option ${cls}" data-pick="${esc(o.id)}" ${s.picked ? 'disabled' : ''}>${esc(o.ko)}</button>`;
    })
    .join('');
  app.innerHTML = `${header('듣기 퀴즈')}
    <section class="card center"><p class="muted">들리는 영어의 뜻을 고르세요</p>
      <button class="btn primary big" data-say="${esc(q.answer.en)}">🔊 듣기</button>
      <button class="btn secondary" data-say-slow="${esc(q.answer.en)}">🐢 느리게</button>
      ${s.picked ? `<div class="en">${esc(q.answer.en)}</div>` : ''}
    </section>
    <section class="options">${opts}</section>
    ${s.picked ? '<div class="actions"><button class="btn primary" data-act="quiz-next">다음 →</button></div>' : ''}
    <p class="small muted center">${s.i + 1} / ${s.questions.length}</p>`;
}

// ---------- scenes I didn't understand (spec §6; Q36: saved on the phone, explained in the evening by the PC) ----------

function fmtTime(sec) {
  if (sec == null || sec === '') return '';
  const n = Math.floor(Number(sec));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

function parseTime(text) {
  if (!text) return null;
  const m = String(text).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$|^(\d+)$/);
  if (!m) return null;
  if (m[4]) return Number(m[4]);
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function sceneStatus(s) {
  if (s.status === 'resolved') return '✅ 학습 목록에 추가했어요';
  if (s.explainedAt) return '💡 설명 도착';
  if (s.error) return `⚠️ ${s.error}`;
  return '🌙 저녁에 컴퓨터가 설명해 줄게요';
}

function refreshSceneViews() {
  const { path } = routeParts();
  if (path === '/watch') renderWatchScenes();
  else if (path === '/scenes') renderScenes();
  else if (path.startsWith('/scene/') && !document.activeElement?.matches('input, textarea')) renderScene(path.slice(7));
}

function sceneDetail(id, s, { compact = false } = {}) {
  const doc = load();
  const added = (s.customIds || []).map((cid) => doc.custom[cid]).filter((c) => c && !c.deleted);
  const props = s.status === 'resolved' ? [] : s.proposals || [];
  const when = s.startSec != null ? `<b>${fmtTime(s.startSec)}</b> ` : '';
  return `<div class="scene card" data-scene="${id}">
    <div class="row"><span>${when}<span class="small muted">${esc(sceneStatus(s))}</span></span>
      ${compact ? '' : `<button class="btn danger small" data-del-scene="${id}">지우기</button>`}</div>
    ${s.said_en ? `<div class="row"><div class="en small-en grow">${esc(s.said_en)}</div><div class="btns">${speakBtn(s.said_en)}</div></div>` : ''}
    ${s.explanation_ko ? `<p>${esc(s.explanation_ko)}</p>` : ''}
    ${s.sound_ko ? `<p class="note">🔉 ${esc(s.sound_ko)}</p>` : ''}
    ${props.length ? `<div class="props">${props.map((p, i) => `<label class="check"><input type="checkbox" checked data-prop="${id}:${i}"> <span><b>${esc(p.en)}</b> — ${esc(p.ko)}<br><span class="small muted">${esc(p.note_ko || '')}</span></span></label>`).join('')}
      <button class="btn primary" data-add-props="${id}">학습 목록에 추가</button></div>` : ''}
    ${added.length ? `<div class="small">${added.map((c) => `✅ ${esc(c.en)} — ${esc(c.ko)}`).join('<br>')}</div>` : ''}
    ${!s.explainedAt ? `<form class="form inline" data-words="${id}"><input name="heard" placeholder="들린 단어나 화면 자막 몇 단어 (선택)" value="${esc(s.heard || '')}"><button class="btn secondary" type="submit">저장</button></form>` : ''}
  </div>`;
}

function renderScenes() {
  const doc = load();
  const list = Object.entries(doc.scenes)
    .filter(([, s]) => !s.deleted)
    .sort(([, a], [, b]) => (a.createdAt < b.createdAt ? 1 : -1));
  const rows = list
    .map(([id, s]) => `<a class="card link" href="#/scene/${id}"><div>${s.status === 'resolved' ? '✅' : s.explainedAt ? '💡' : '🌙'} <b>${esc(s.said_en || s.heard || s.title || '장면')}</b></div>
      <div class="small muted">${esc(s.title || s.context || '')} ${s.startSec != null ? `· ${fmtTime(s.startSec)}` : ''}</div></a>`)
    .join('');
  app.innerHTML = `${header('이해 못 한 장면')}
    <p class="small muted">영상을 보다가 <b>🙋 이해 못 했어요</b>를 누르면 여기에 모여요. 저녁에 컴퓨터 게임을 켜면 컴퓨터가 영상 자막에서 그 대사를 찾아 설명을 붙여요. 앱 밖에서 본 영상(TV, 영화 등)은 아래 버튼으로 직접 적을 수 있어요.</p>
    <a class="btn secondary big" href="#/scenes/new">+ 직접 적기</a>
    ${rows || '<div class="card muted">아직 저장한 장면이 없어요</div>'}`;
}

function renderSceneNew() {
  app.innerHTML = `${header('직접 적기', '#/scenes')}
    <form class="card form" id="scene-form">
      <label>들린 대로 적기 <span class="muted">(정확하지 않아도 돼요)</span><textarea name="heard" required rows="2" placeholder="I'm down to grab a bite"></textarea></label>
      <label>장면 설명 <span class="muted">(선택)</span><input name="context" placeholder="친구 둘이 저녁 먹을지 이야기하는 장면"></label>
      <label>유튜브 링크 <span class="muted">(선택)</span><input name="url" type="url" placeholder="https://youtu.be/..."></label>
      <label>시간 <span class="muted">(선택, 예: 12:34)</span><input name="time" placeholder="12:34"></label>
      <button class="btn primary big" type="submit">저장</button>
    </form>`;
  document.getElementById('scene-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const url = f.get('url').trim();
    const id = uuid();
    update((doc) => {
      putRecord(doc, 'scenes', id, {
        heard: f.get('heard').trim(), context: f.get('context').trim(), videoUrl: url, videoId: url ? youtube.videoId(url) : null,
        startSec: parseTime(f.get('time')), status: 'open', customIds: [], createdAt: new Date().toISOString(),
      });
    });
    sync.syncNow();
    go(`#/scene/${id}`);
  });
}

function renderScene(id) {
  const s = load().scenes[id];
  if (!s || s.deleted) return go('#/scenes');
  const replay = s.videoId ? `<a class="btn secondary" href="#/watch?v=${encodeURIComponent(s.videoId)}&t=${Math.max(0, (s.startSec || 0) - 8)}">▶ 장면 다시 보기</a>` : '';
  app.innerHTML = `${header('장면', '#/scenes')}
    ${s.title ? `<p class="small muted">${esc(s.title)}</p>` : ''}
    ${sceneDetail(id, s)}
    ${replay}
    <details class="card"><summary class="small">✍️ 표현 직접 추가</summary>
      <form class="form" id="custom-form"><input name="en" placeholder="영어 표현" required><input name="ko" placeholder="한국어 뜻" required><input name="note" placeholder="메모 (선택)">
      <button class="btn secondary" type="submit">추가</button></form></details>`;
  document.getElementById('custom-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    addCustom(id, [{ en: f.get('en').trim(), ko: f.get('ko').trim(), note_ko: f.get('note').trim() }]);
  });
}

function addCustom(sceneId, list) {
  update((doc) => {
    const scene = doc.scenes[sceneId];
    const ids = [...(scene.customIds || [])];
    for (const p of list) {
      const cid = uuid();
      putRecord(doc, 'custom', cid, { en: p.en, ko: p.ko, note_ko: p.note_ko || '', source: 'scene', sceneId, createdAt: new Date().toISOString() });
      review(doc, `c:${cid}`, 'learn');
      ids.push(cid);
    }
    putRecord(doc, 'scenes', sceneId, { ...scene, customIds: ids, status: 'resolved' });
  });
  sync.syncNow();
  refreshSceneViews();
}

// ---------- videos (Q34: watch inside the app, Q35: in-app search + lesson videos) ----------

let lastSearch = JSON.parse(sessionStorage.getItem('et.lastSearch') || 'null');

function videoCard(v) {
  const href = `#/watch?v=${encodeURIComponent(v.id)}${v.start ? `&t=${v.start}` : ''}`;
  return `<a class="vcard" href="${href}"><img src="${esc(v.thumb || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`)}" alt="" loading="lazy">
    <div class="grow"><div class="vtitle">${esc(v.title)}</div><div class="small muted">${esc(v.channel || '')}${v.minutes ? ` · ${v.minutes}분` : ''}</div>${v.note_ko ? `<div class="small">${esc(v.note_ko)}</div>` : ''}</div></a>`;
}

function lessonVideos() {
  const doc = load();
  const t = today();
  const pick = pickNewLesson(content.order, doc.morning, t);
  const recent = content.order.filter((id) => doc.morning[id] && !doc.morning[id].deleted).reverse();
  const ids = [...new Set([pick.lesson, ...recent].filter(Boolean))].slice(0, 3);
  return ids.map((id) => content.lessonById.get(id)).filter((l) => l?.videos?.length);
}

function renderVideos() {
  const lessons = lessonVideos();
  const lessonHtml = lessons.map((l) => `<section class="card"><h2>📖 ${esc(l.title_ko)}</h2>${l.videos.map(videoCard).join('')}</section>`).join('');
  const channels = content.videos.groups
    .map((g) => `<section class="card"><h2>${esc(g.title_ko)}</h2>${g.items.map((i) => (youtube.searchEnabled()
      ? `<button class="row link plainbtn" data-search="${esc(i.query || i.title)}"><div class="grow"><b>${esc(i.title)}</b><br><span class="small muted">${esc(i.note_ko)}</span></div><span>🔎</span></button>`
      : `<a class="row link" href="${esc(i.url)}" target="_blank" rel="noopener"><div class="grow"><b>${esc(i.title)}</b><br><span class="small muted">${esc(i.note_ko)}</span></div><span>↗</span></a>`)).join('')}</section>`)
    .join('');
  app.innerHTML = `${header('영상 보기')}
    ${youtube.searchEnabled()
      ? `<form class="card form search" id="search-form"><div class="row"><input name="q" placeholder="유튜브 검색 (예: friends coffee scene)" value="${esc(lastSearch?.q || '')}" required><button class="btn primary" type="submit">🔎</button></div>
         <label class="check small"><input type="checkbox" name="cc" ${lastSearch?.cc === false ? '' : 'checked'}> 영어 자막 있는 영상만</label></form>
         <div id="results">${lastSearch?.items ? lastSearch.items.map(videoCard).join('') : ''}</div>`
      : '<div class="card small muted">앱 안 유튜브 검색은 설정이 끝나면 켜져요 (setup-2-keys.md A)</div>'}
    ${lessonHtml}
    ${channels}
    <details class="card"><summary class="small">링크로 보기</summary>
      <form class="form" id="watch-form"><input name="url" type="url" placeholder="https://youtu.be/..." required><button class="btn secondary" type="submit">앱에서 보기</button></form></details>`;
  document.getElementById('search-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    runSearch(f.get('q').trim(), f.get('cc') === 'on');
  });
  document.getElementById('watch-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const url = new FormData(ev.target).get('url').trim();
    const id = youtube.videoId(url);
    if (id) go(`#/watch?v=${encodeURIComponent(id)}&t=${youtube.startSeconds(url)}`);
  });
}

async function runSearch(q, cc) {
  const box = document.getElementById('results');
  if (box) box.innerHTML = '<div class="card muted">검색 중…</div>';
  try {
    const items = await youtube.search(q, { captionsOnly: cc });
    lastSearch = { q, cc, items };
    sessionStorage.setItem('et.lastSearch', JSON.stringify(lastSearch));
    if (routeParts().path !== '/videos') go('#/videos');
    else if (box) box.innerHTML = items.map(videoCard).join('') || '<div class="card muted">결과가 없어요</div>';
  } catch (e) {
    if (box) box.innerHTML = `<div class="card">${esc(e.message)}</div>`;
  }
}

let ytPlayer = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
}

function renderWatch(params) {
  const id = params.get('v') || youtube.videoId(params.get('u') || '');
  if (!id) return go('#/videos');
  const start = Number(params.get('t') || 0);
  session = { kind: 'watch', videoId: id, start };
  app.innerHTML = `${header('영상 보기', '#/videos')}
    <div class="video"><div id="yt"></div></div>
    <div class="actions"><button class="btn secondary" data-act="back10">⏪ 10초 뒤로</button><button class="btn primary" data-act="save-scene">🙋 이해 못 했어요</button></div>
    <p class="small muted center">모르는 대사가 지나가면 바로 누르세요. 영상은 계속 볼 수 있어요. 저녁에 컴퓨터 게임을 켜면 설명이 붙어요.</p>
    <section id="scene-list"></section>`;
  renderWatchScenes();
  if (!navigator.onLine) {
    document.getElementById('yt').outerHTML = '<p class="card">영상은 인터넷이 연결되어 있어야 볼 수 있어요.</p>';
    return;
  }
  loadYouTubeApi().then(() => {
    if (routeParts().path !== '/watch') return;
    ytPlayer = new window.YT.Player('yt', { videoId: id, playerVars: { start, playsinline: 1, rel: 0, cc_load_policy: 0 } });
  });
}

function renderWatchScenes() {
  const box = document.getElementById('scene-list');
  if (!box || session?.kind !== 'watch') return;
  const list = Object.entries(load().scenes)
    .filter(([, s]) => !s.deleted && s.videoId === session.videoId)
    .sort(([, a], [, b]) => (b.startSec ?? 0) - (a.startSec ?? 0));
  box.innerHTML = list.map(([sid, s]) => sceneDetail(sid, s, { compact: true })).join('');
}

function saveSceneHere() {
  const t = ytPlayer?.getCurrentTime ? Math.floor(ytPlayer.getCurrentTime()) : session.start || 0;
  const title = ytPlayer?.getVideoData ? ytPlayer.getVideoData().title || '' : '';
  const id = uuid();
  update((doc) => {
    putRecord(doc, 'scenes', id, {
      videoId: session.videoId, videoUrl: youtube.watchUrl(session.videoId, t), startSec: t, title,
      heard: '', context: '', answer: '', status: 'open', customIds: [], createdAt: new Date().toISOString(),
    });
  });
  sync.syncNow();
  renderWatchScenes();
}

// ---------- settings ----------

function renderSettings() {
  const s = sync.getStatus();
  const voices = speech.listVoices();
  const cur = speech.currentVoice();
  const statusText = {
    done: `마지막 동기화: ${s.at ? new Date(s.at).toLocaleString('ko-KR') : '-'}`,
    syncing: '동기화 중…',
    offline: '오프라인이에요. 연결되면 동기화해요',
    error: s.message,
    'needs-login': s.message,
    'needs-token': '로그인 확인이 필요해요. 아래 버튼을 눌러주세요',
    idle: '',
  }[s.state] || '';
  app.innerHTML = `${header('설정')}
    <section class="card"><h2>📺 유튜브 로그인 (광고 없애기 시험)</h2>
      <p class="small muted">유튜브 프리미엄 계정으로 이 앱 안에서 로그인해 두면, 앱 안 영상에도 프리미엄이 적용될 수 있어요. 먼저 아이폰 <b>설정 → 앱 → Safari → 크로스 사이트 추적 방지</b>를 꺼야 해요 (사파리 전체에 적용돼요).</p>
      <button class="btn secondary" data-act="yt-login">유튜브 로그인</button>
    </section>
    <section class="card"><h2>☁️ 구글 드라이브 동기화</h2>
      <p class="small muted">학습 기록을 내 구글 드라이브의 숨겨진 앱 전용 폴더에 저장해서, 저녁에 컴퓨터 게임과 이어서 써요.</p>
      ${sync.isConnected()
        ? `<p>연결됨 ✅</p><p class="small">${esc(statusText)}</p>
           <div class="actions"><button class="btn primary" data-act="sync">지금 동기화</button><button class="btn secondary" data-act="relogin">로그인 다시 하기</button></div>
           <button class="btn danger small" data-act="logout">연결 끊기</button>`
        : '<button class="btn primary big" data-act="login">구글로 로그인</button>'}
    </section>
    <section class="card"><h2>🔊 목소리</h2>
      ${speech.supported() ? `<label>음성<select id="voice">${voices.map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label>속도 <span class="muted" id="rate-val">${speech.getRate()}</span><input id="rate" type="range" min="0.6" max="1.2" step="0.05" value="${speech.getRate()}"></label>
      <button class="btn secondary" data-say="Hi! How's it going? Nice to meet you.">들어보기</button>
      <p class="small muted">아이폰 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성 → 영어에서 "향상된 음질" 음성을 내려받으면 더 자연스러워요.</p>` : '<p>이 브라우저는 읽어주기를 지원하지 않아요.</p>'}
    </section>
    <section class="card small muted"><p>앱 버전: ${APP_VERSION}</p><p>기기 ID: ${esc(localStorage.getItem('et.deviceId') || '')}</p>
      <p><a href="privacy.html">개인정보처리방침</a> · <a href="terms.html">서비스 약관</a></p></section>`;
  const voiceSel = document.getElementById('voice');
  if (voiceSel) voiceSel.addEventListener('change', () => speech.setVoice(voiceSel.value));
  const rate = document.getElementById('rate');
  if (rate) rate.addEventListener('input', () => { speech.setRate(rate.value); document.getElementById('rate-val').textContent = rate.value; });
}

// ---------- router + events ----------

async function render() {
  const { path, params } = routeParts();
  if (session && !['/learn', '/review', '/quiz', '/watch'].includes(path)) session = null;
  if (path !== '/watch' && ytPlayer) {
    ytPlayer.destroy?.();
    ytPlayer = null;
  }
  if (path === '/') renderHome();
  else if (path === '/learn') startLearn();
  else if (path === '/review') startReview();
  else if (path.startsWith('/lesson/')) renderLessonView(path.slice(8));
  else if (path === '/learned') renderLearned();
  else if (path === '/quiz') startQuiz();
  else if (path === '/scenes') renderScenes();
  else if (path === '/scenes/new') renderSceneNew();
  else if (path.startsWith('/scene/')) renderScene(path.slice(7));
  else if (path === '/videos') renderVideos();
  else if (path === '/watch') renderWatch(params);
  else if (path === '/settings') renderSettings();
  else go('#/');
  window.scrollTo(0, 0);
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('button, [data-say]');
  if (!el) return;
  const d = el.dataset;
  if (d.say) return speech.speak(d.say);
  if (d.saySlow) return speech.speak(d.saySlow, { slow: true });
  if (d.pick && session?.kind === 'quiz') {
    const q = session.questions[session.i];
    session.picked = d.pick;
    if (d.pick === q.answer.id) session.correct += 1;
    renderQuiz();
    speech.speak(q.answer.en);
    return;
  }
  if (d.search) return runSearch(d.search, true);
  if (d.addProps) {
    const id = d.addProps;
    const proposals = load().scenes[id].proposals || [];
    const chosen = [...document.querySelectorAll(`[data-prop^="${id}:"]`)]
      .filter((c) => c.checked)
      .map((c) => proposals[Number(c.dataset.prop.split(':')[1])])
      .filter(Boolean);
    if (chosen.length) addCustom(id, chosen);
    return;
  }
  if (d.delScene) {
    if (!confirm('이 장면을 지울까요?')) return;
    update((doc) => putRecord(doc, 'scenes', d.delScene, { ...doc.scenes[d.delScene], deleted: true }));
    sync.syncNow();
    return go('#/scenes');
  }
  switch (d.act) {
    case 'known': case 'next': case 'reveal': case 'ok': case 'miss':
      return sessionAction(d.act);
    case 'quiz-next':
      session.i += 1;
      session.picked = null;
      renderQuiz();
      if (session) speech.speak(session.questions[session.i].answer.en);
      return;
    case 'quiz-again':
      return startQuiz();
    case 'save-scene':
      return saveSceneHere();
    case 'back10':
      if (ytPlayer?.getCurrentTime) ytPlayer.seekTo(Math.max(0, ytPlayer.getCurrentTime() - 10), true);
      return;
    case 'yt-login':
      location.href = `https://accounts.google.com/ServiceLogin?service=youtube&continue=${encodeURIComponent('https://www.youtube.com/')}`;
      return;
    case 'login': case 'relogin':
      return sync.signIn();
    case 'logout':
      sync.signOut();
      return renderSettings();
    case 'sync':
      await sync.syncNow();
      return renderSettings();
    default:
  }
});

window.addEventListener('hashchange', render);
document.addEventListener('submit', (ev) => {
  const id = ev.target.dataset?.words;
  if (!id) return;
  ev.preventDefault();
  const heard = new FormData(ev.target).get('heard').trim();
  update((doc) => putRecord(doc, 'scenes', id, { ...doc.scenes[id], heard, error: '' }));
  sync.syncNow();
  refreshSceneViews();
});
sync.onStatus(() => {
  const chip = document.querySelector('.bar .chip');
  if (chip) chip.outerHTML = syncChip();
  if (routeParts().path === '/settings') renderSettings();
});
onChange(() => {
  if (routeParts().path === '/') renderHome();
});

async function main() {
  const fromRedirect = sync.handleRedirect();
  try {
    content = await loadContent();
  } catch {
    app.innerHTML = '<section class="card"><h2>학습 내용을 불러오지 못했어요</h2><p>인터넷에 연결한 뒤 다시 열어주세요.</p></section>';
    return;
  }
  render();
  if (fromRedirect) sync.syncNow();
  else sync.syncOnOpen();
  for (const k of ['et.geminiKey', 'et.geminiModel', 'et.geminiLiteModel', 'et.geminiQuotaDay']) localStorage.removeItem(k); // Q36: Gemini removed
  window.addEventListener('online', () => sync.syncNow());
  if ('serviceWorker' in navigator) {
    // A new version took over: reload once so the page runs the new files, not the cached old ones.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !sessionStorage.getItem('et.reloaded')) {
        sessionStorage.setItem('et.reloaded', '1');
        location.reload();
      }
    });
    navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
  }
}

main();
