// Plays the beep sound file: client/public/beep.wav  (served at /beep.wav)
// To use your own sound, replace that file (keep the name) or change BEEP_URL below.
const BEEP_URL = '/beep.wav';

const audio = new Audio(BEEP_URL);
audio.preload = 'auto';
audio.volume = 1;
audio.load();

// Browsers only allow sound after the first touch/click, so "unlock" it then.
let unlocked = false;
function unlock() {
  if (unlocked) return;
  audio.muted = true;
  const p = audio.play();
  const done = () => { audio.pause(); audio.currentTime = 0; audio.muted = false; unlocked = true; };
  if (p && p.then) p.then(done).catch(() => { audio.muted = false; });
  else done();
}
['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].forEach((e) =>
  document.addEventListener(e, unlock, { passive: true })
);

export function beep() {
  try {
    audio.muted = false;
    audio.volume = 1;
    audio.currentTime = 0;
    const p = audio.play();
    if (p && p.catch) p.catch((e) => console.warn('Beep was blocked or the file was not found:', e));
  } catch (e) {
    console.warn('Beep failed:', e);
  }
  try { navigator.vibrate?.(120); } catch { /* ignore */ }
}

// For testing: open the browser console (F12) and type  testBeep()
window.testBeep = beep;