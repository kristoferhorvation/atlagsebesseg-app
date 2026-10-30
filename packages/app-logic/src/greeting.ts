import { t } from './i18n';
import { normalizeName } from './settings';

/** AOS14: az üres nézet köszöntője – kitöltött megszólítással „Szia Kristof!”, üresen „Szia!”. */
export function greetingText(name: string): string {
  const n = normalizeName(name);
  return n ? t('greet.named', { name: n }) : t('greet.anon');
}

/** AOS14: a navigáció indításakor elhangzó köszönés (a kézi mérés indításakor nincs) – „Szia Kristof, indulhatunk!”. */
export function greetingVoice(name: string): string {
  const n = normalizeName(name);
  return n ? t('nav.voice.greetNamed', { name: n }) : t('nav.voice.greet');
}
