// Text normalization and speaking scores (shared/review-rules.md §3).

const CONTRACTIONS = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are',
  "he's": 'he is', "she's": 'she is', "it's": 'it is',
  "that's": 'that is', "what's": 'what is', "there's": 'there is', "here's": 'here is',
  "who's": 'who is', "where's": 'where is', "how's": 'how is', "let's": 'let us',
  "i've": 'i have', "you've": 'you have', "we've": 'we have', "they've": 'they have',
  "i'll": 'i will', "you'll": 'you will', "we'll": 'we will', "they'll": 'they will',
  "he'll": 'he will', "she'll": 'she will', "it'll": 'it will', "that'll": 'that will',
  "i'd": 'i would', "you'd": 'you would', "we'd": 'we would', "they'd": 'they would',
  "he'd": 'he would', "she'd": 'she would',
  "can't": 'can not', cannot: 'can not', "won't": 'will not',
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
  "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not',
  "haven't": 'have not', "hasn't": 'has not', "hadn't": 'had not',
  "shouldn't": 'should not', "wouldn't": 'would not', "couldn't": 'could not',
  wanna: 'want to', gonna: 'going to', gotta: 'got to',
  kinda: 'kind of', sorta: 'sort of', gimme: 'give me', "y'all": 'you all',
  ok: 'okay',
};
const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const FILLERS = new Set(['um', 'uh', 'erm', 'hmm', 'mm', 'ah']);

export function normalize(text) {
  const words = [];
  const cleaned = (text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']+/g, ' ');
  for (let token of cleaned.split(' ')) {
    token = token.replace(/^'+|'+$/g, '');
    if (!token) continue;
    if (/^\d+$/.test(token) && Number(token) <= 12) token = NUMBERS[Number(token)];
    const expanded = CONTRACTIONS[token] ?? token;
    for (const w of expanded.split(' ')) if (!FILLERS.has(w)) words.push(w);
  }
  return words;
}

// LCS with the fixed backtrack rule from review-rules.md: on a mismatch, step up (drop a ref word)
// when L[i-1][j] >= L[i][j-1], otherwise step left.
function lcsMatches(ref, heard) {
  const n = ref.length;
  const m = heard.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      L[i][j] = ref[i - 1] === heard[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    }
  }
  const matched = new Array(n).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (ref[i - 1] === heard[j - 1]) {
      matched[i - 1] = true;
      i -= 1;
      j -= 1;
    } else if (L[i - 1][j] >= L[i][j - 1]) i -= 1;
    else j -= 1;
  }
  return { length: L[n][m], matched };
}

// Returns { score, marks } where marks has one boolean per whitespace token of `ref`.
export function wordScore(ref, heard) {
  const tokens = (ref || '').split(/\s+/).filter(Boolean);
  const owner = [];
  const refWords = [];
  tokens.forEach((t, ti) => {
    for (const w of normalize(t)) {
      refWords.push(w);
      owner.push(ti);
    }
  });
  const { length, matched } = lcsMatches(refWords, normalize(heard));
  const marks = tokens.map(() => true);
  matched.forEach((ok, wi) => {
    if (!ok) marks[owner[wi]] = false;
  });
  return { score: refWords.length ? length / refWords.length : 0, marks };
}

// mode: 'follow' (1st round) or 'meaning' (2nd/3rd round). Returns { verdict, score, best }.
export function judge(mode, en, accept, heard) {
  const candidates = mode === 'follow' ? [en] : [en, ...(accept || [])];
  let best = candidates[0];
  let score = -1;
  for (const c of candidates) {
    const s = wordScore(c, heard).score;
    if (s > score) {
      score = s;
      best = c;
    }
  }
  let verdict;
  if (mode === 'follow') verdict = score >= 0.9 ? 'pass' : 'fail';
  else verdict = score >= 0.8 ? 'pass' : score >= 0.5 ? 'unsure' : 'fail';
  return { verdict, score, best };
}

export function detect(expression, utterance) {
  const phrases = expression.detect && expression.detect.length ? expression.detect : [expression.en];
  const said = normalize(utterance);
  return phrases.some((p) => {
    const words = normalize(p);
    if (!words.length) return false;
    for (let i = 0; i + words.length <= said.length; i += 1) {
      if (words.every((w, k) => said[i + k] === w)) return true;
    }
    return false;
  });
}
