// Text-to-speech with the device's built-in voices (spec §9.1: iPhone voices, no server).

const VOICE_KEY = 'et.voice';
const RATE_KEY = 'et.rate';
let voices = [];

function refresh() {
  voices = (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang.replace('_', '-').startsWith('en-US'));
}

if ('speechSynthesis' in window) {
  refresh();
  speechSynthesis.addEventListener?.('voiceschanged', refresh);
}

export const supported = () => 'speechSynthesis' in window;

export function listVoices() {
  refresh();
  return voices.map((v) => v.name);
}

function pickVoice() {
  refresh();
  const saved = localStorage.getItem(VOICE_KEY);
  return (
    voices.find((v) => v.name === saved) ||
    voices.find((v) => /premium|enhanced/i.test(v.name)) ||
    voices.find((v) => /samantha|ava|allison|aaron|nicky/i.test(v.name)) ||
    voices[0] ||
    null
  );
}

export function setVoice(name) {
  localStorage.setItem(VOICE_KEY, name);
}

export function currentVoice() {
  return pickVoice()?.name || '(기본 음성)';
}

export function setRate(rate) {
  localStorage.setItem(RATE_KEY, String(rate));
}

export function getRate() {
  return Number(localStorage.getItem(RATE_KEY) || 0.95);
}

export function speak(text, { slow = false } = {}) {
  if (!supported()) return Promise.resolve();
  speechSynthesis.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = 'en-US';
    u.rate = slow ? 0.6 : getRate();
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}
