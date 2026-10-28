import { LOCALES, langOfTag, type Lang, type VoiceKind } from '@atlagsebesseg/app-logic';

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** Fejlesztői/teszt-horog: a szimulátorban a bemondott mondatok a `window.__navVoice`-ba is kerülnek. */
function record(text: string, kind: VoiceKind): void {
  const w = window as unknown as { __navVoice?: { text: string; kind: string }[] };
  (w.__navVoice ??= []).push({ text, kind });
}

/**
 * Mondat felolvasása az app nyelvén (Web Speech API). Fontos mondatnál (szakasz, „túl gyors”,
 * újratervezés) a már várakozó közönséges utasítások elhagyódnak, hogy a figyelmeztetés késedelem nélkül szóljon.
 */
export function speak(text: string, lang: Lang, kind: VoiceKind, simMode = false): void {
  if (simMode) record(text, kind);
  if (!supported()) return;
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = LOCALES[lang];
  const voice = synth.getVoices().find((v) => langOfTag(v.lang) === lang);
  if (voice) u.voice = voice;
  if (kind !== 'instruction') synth.cancel();
  synth.speak(u);
}

/** iOS Safari csak felhasználói koppintásból engedi a beszédet: az „Indítás” gombnál egy néma mondattal feloldjuk. */
export function unlockSpeech(): void {
  if (!supported()) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

export function stopSpeech(): void {
  if (supported()) window.speechSynthesis.cancel();
}
