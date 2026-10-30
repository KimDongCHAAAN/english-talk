// Phone web app (spec §3 commute flow, §6 scenes, §4.3 videos, §9.1). Hash routes, one render() per route.
import { loadContent, findExpression } from './lib/content.js';
import { load, update, review, addXp, putRecord, today, uuid, onChange } from './lib/store.js';
import { dueReviews, pickNewLesson, xpTotal, levelForXp, streak } from './lib/srs.js';
import * as speech from './lib/speech.js';
import * as sync from './lib/sync.js';

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

// ---------- scenes I didn't understand (spec §6) ----------

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

function renderScenes() {
  const doc = load();
  const list = Object.entries(doc.scenes)
    .filter(([, s]) => !s.deleted)
    .sort(([, a], [, b]) => (a.status === b.status ? (a.createdAt < b.createdAt ? 1 : -1) : a.status === 'open' ? -1 : 1));
  const rows = list
    .map(([id, s]) => `<a class="card link" href="#/scene/${id}"><div>${s.status === 'open' ? '❓' : '✅'} <b>${esc(s.heard)}</b></div><div class="small muted">${esc(s.context || '')} ${s.startSec != null ? '· ' + fmtTime(s.startSec) : ''}</div></a>`)
    .join('');
  app.innerHTML = `${header('이해 못 한 장면')}
    <a class="btn primary big" href="#/scenes/new">+ 새 장면 저장</a>
    <p class="small muted">영상을 보다가 들었는데 이해 못 한 부분을 모아두세요. AI에게 물어보고, 설명을 받으면 학습 목록에 넣을 수 있어요.</p>
    ${rows || '<div class="card muted">아직 저장한 장면이 없어요</div>'}`;
}

function renderSceneNew(params) {
  const url = params.get('u') || '';
  const t = params.get('t');
  app.innerHTML = `${header('새 장면', '#/scenes')}
    <form class="card form" id="scene-form">
      <label>들린 대로 적기 <span class="muted">(정확하지 않아도 돼요)</span><textarea name="heard" required rows="2" placeholder="I'm down to grab a bite"></textarea></label>
      <label>유튜브 링크 <span class="muted">(선택)</span><input name="url" type="url" value="${esc(url)}" placeholder="https://youtu.be/..."></label>
      <label>시간 <span class="muted">(선택, 예: 12:34)</span><input name="time" value="${esc(t != null ? fmtTime(t) : '')}" placeholder="12:34"></label>
      <label>장면 설명 <span class="muted">(선택)</span><input name="context" placeholder="친구 둘이 저녁 먹을지 이야기하는 장면"></label>
      <button class="btn primary big" type="submit">저장</button>
    </form>`;
  document.getElementById('scene-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const id = uuid();
    update((doc) => {
      putRecord(doc, 'scenes', id, {
        heard: f.get('heard').trim(), videoUrl: f.get('url').trim(), startSec: parseTime(f.get('time')),
        context: f.get('context').trim(), answer: '', status: 'open', customIds: [], createdAt: new Date().toISOString(),
      });
    });
    sync.syncNow();
    go(`#/scene/${id}`);
  });
}

function askPrompt(s) {
  return [
    '아래는 내가 영어 영상을 보다가 이해하지 못한 장면이야. 나는 한국인이고 영어 회화 초보(CEFR A2)야.',
    `- 들린 대로 적은 문장 (정확하지 않을 수 있음): "${s.heard}"`,
    s.videoUrl ? `- 영상: ${s.videoUrl}${s.startSec != null ? ` (${fmtTime(s.startSec)} 부근)` : ''}` : '',
    s.context ? `- 장면 설명: ${s.context}` : '',
    '',
    '1) 실제로 뭐라고 말했을지 추정해서 정확한 영어 문장으로 써 줘.',
    '2) 뜻과 문맥, 왜 그렇게 말했는지 쉬운 한국어로 설명해 줘.',
    '3) 잘 안 들린 이유(연음, 축약 등)가 있으면 알려 줘.',
    '4) 마지막에, 내가 외우면 좋을 표현 1~3개를 아래 JSON 형식 그대로 적어 줘:',
    '{"expressions":[{"en":"영어 표현","ko":"한국어 뜻","note_ko":"언제 쓰는지 한 줄 설명"}]}',
  ].filter((l) => l !== '').join('\n');
}

function parseAnswer(text) {
  const start = text.lastIndexOf('{"expressions"');
  const from = start >= 0 ? start : text.indexOf('{');
  if (from < 0) return [];
  for (let end = text.length; end > from; end = text.lastIndexOf('}', end - 1)) {
    try {
      const data = JSON.parse(text.slice(from, end + 1));
      return (data.expressions || []).filter((e) => e.en && e.ko);
    } catch {
      // keep shrinking until the JSON parses
    }
    if (end < 0) break;
  }
  return [];
}

function renderScene(id) {
  const doc = load();
  const s = doc.scenes[id];
  if (!s || s.deleted) return go('#/scenes');
  const proposals = parseAnswer(s.answer || '');
  const added = (s.customIds || []).map((cid) => doc.custom[cid]).filter((c) => c && !c.deleted);
  const watch = s.videoUrl ? `<a class="btn secondary" href="#/watch?u=${encodeURIComponent(s.videoUrl)}${s.startSec != null ? `&t=${s.startSec}` : ''}">▶ 장면 다시 보기</a>` : '';
  app.innerHTML = `${header('장면', '#/scenes')}
    <section class="card"><div class="en small-en">${esc(s.heard)}</div>${s.context ? `<p class="muted">${esc(s.context)}</p>` : ''}${watch}</section>
    <section class="card">
      <h2>🤖 AI에게 물어보기</h2>
      <p class="small">1) 아래 버튼으로 질문을 복사해서 Claude나 ChatGPT 앱에 붙여넣으세요.<br>2) 받은 답을 그대로 아래 칸에 붙여넣으세요.</p>
      <button class="btn primary" data-copy-scene="${id}">질문 복사하기</button>
      <textarea id="answer" rows="6" placeholder="AI의 답을 여기에 붙여넣기">${esc(s.answer || '')}</textarea>
      <button class="btn secondary" data-save-answer="${id}">답 저장</button>
    </section>
    ${proposals.length ? `<section class="card"><h2>📌 외울 표현</h2>${proposals.map((p, i) => `<label class="check"><input type="checkbox" checked data-prop="${i}"> <span><b>${esc(p.en)}</b><br><span class="muted">${esc(p.ko)}</span></span></label>`).join('')}
      <button class="btn primary" data-add-props="${id}">학습 목록에 추가</button></section>` : ''}
    <section class="card"><h2>✍️ 직접 추가</h2>
      <form class="form" id="custom-form"><input name="en" placeholder="영어 표현" required><input name="ko" placeholder="한국어 뜻" required><input name="note" placeholder="메모 (선택)">
      <button class="btn secondary" type="submit">추가</button></form></section>
    ${added.length ? `<section class="card"><h2>✅ 추가한 표현</h2>${added.map((c) => `<div class="row"><div class="grow"><b>${esc(c.en)}</b><br><span class="muted">${esc(c.ko)}</span></div>${speakBtn(c.en)}</div>`).join('')}</section>` : ''}
    <button class="btn danger small" data-del-scene="${id}">이 장면 지우기</button>`;
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
  renderScene(sceneId);
}

// ---------- videos (spec §4.3, Q28: official YouTube embed, links only) ----------

function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1).split('/')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(embed|shorts|live)\/([\w-]{6,})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

function urlStart(url) {
  try {
    const t = new URL(url).searchParams.get('t');
    return t ? parseInt(t, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function renderVideos() {
  const groups = content.videos.groups
    .map((g) => `<section class="card"><h2>${esc(g.title_ko)}</h2>${g.items.map((i) => `<a class="row link" href="${esc(i.url)}" target="_blank" rel="noopener"><div class="grow"><b>${esc(i.title)}</b><br><span class="small muted">${esc(i.note_ko)}</span></div><span>↗</span></a>`).join('')}</section>`)
    .join('');
  app.innerHTML = `${header('영상 보기')}
    <form class="card form" id="watch-form"><h2>▶ 링크로 영상 보기</h2><p class="small muted">유튜브 앱에서 '공유 → 링크 복사' 후 붙여넣으세요. 앱 안에서 보다가 모르는 장면을 바로 저장할 수 있어요.</p>
      <input name="url" type="url" placeholder="https://youtu.be/..." required><button class="btn primary" type="submit">앱에서 보기</button></form>
    ${groups}`;
  document.getElementById('watch-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    go(`#/watch?u=${encodeURIComponent(new FormData(ev.target).get('url').trim())}`);
  });
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
  const url = params.get('u') || '';
  const id = youtubeId(url);
  if (!id) {
    app.innerHTML = `${header('영상 보기', '#/videos')}<section class="card"><p>유튜브 링크를 알아보지 못했어요.</p></section>`;
    return;
  }
  const start = Number(params.get('t') || urlStart(url) || 0);
  app.innerHTML = `${header('영상 보기', '#/videos')}
    <div class="video"><div id="yt"></div></div>
    <button class="btn primary big" data-act="save-scene">🙋 이 장면 이해 못 했어요</button>
    <p class="small muted center">누르면 지금 시간과 링크가 저장돼요. 들린 대로 적어주세요.</p>`;
  if (!navigator.onLine) {
    document.getElementById('yt').outerHTML = '<p class="card">영상은 인터넷이 연결되어 있어야 볼 수 있어요.</p>';
    return;
  }
  loadYouTubeApi().then(() => {
    ytPlayer = new window.YT.Player('yt', { videoId: id, playerVars: { start, playsinline: 1, rel: 0 } });
  });
  session = { kind: 'watch', url, start };
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
    <section class="card small muted"><p>기기 ID: ${esc(localStorage.getItem('et.deviceId') || '')}</p>
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
  if (path === '/') renderHome();
  else if (path === '/learn') startLearn();
  else if (path === '/review') startReview();
  else if (path.startsWith('/lesson/')) renderLessonView(path.slice(8));
  else if (path === '/learned') renderLearned();
  else if (path === '/quiz') startQuiz();
  else if (path === '/scenes') renderScenes();
  else if (path === '/scenes/new') renderSceneNew(params);
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
  if (d.copyScene) {
    const s = load().scenes[d.copyScene];
    await navigator.clipboard.writeText(askPrompt(s)).catch(() => {});
    el.textContent = '복사했어요 ✅ AI 앱에 붙여넣으세요';
    return;
  }
  if (d.saveAnswer) {
    const answer = document.getElementById('answer').value;
    update((doc) => putRecord(doc, 'scenes', d.saveAnswer, { ...doc.scenes[d.saveAnswer], answer }));
    sync.syncNow();
    return renderScene(d.saveAnswer);
  }
  if (d.addProps) {
    const proposals = parseAnswer(load().scenes[d.addProps].answer || '');
    const chosen = [...document.querySelectorAll('[data-prop]')].filter((c) => c.checked).map((c) => proposals[Number(c.dataset.prop)]);
    if (chosen.length) addCustom(d.addProps, chosen);
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
    case 'save-scene': {
      const t = ytPlayer?.getCurrentTime ? Math.floor(ytPlayer.getCurrentTime()) : session?.start || 0;
      ytPlayer?.pauseVideo?.();
      return go(`#/scenes/new?u=${encodeURIComponent(session?.url || '')}&t=${t}`);
    }
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
  window.addEventListener('online', () => sync.syncNow());
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

main();
