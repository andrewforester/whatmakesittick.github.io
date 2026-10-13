import i18next from 'i18next';
import en from '../locales/en.json';
import { NAMESPACE, TRANSLATION_OPTIONS } from './config';
import { detectLanguage } from './detect';
import { DEFAULT_LANGUAGE, LANGUAGES, baseLanguage } from './languages';
import type { LanguageCode } from './languages';
import { createDictionaryLoader, loadersByLanguage } from './loader';
import type { DictionaryLoader } from './loader';
import { LANGUAGE_STORAGE_KEY } from './redirect';
import type { Dictionary, LocaleLoaders } from './resources';

export { DEFAULT_LANGUAGE, LANGUAGES } from './languages';
export type { Language, LanguageCode } from './languages';
export { shippedLanguages } from './loader';
export { LANGUAGE_QUERY_KEY } from './paths';
export type { Dictionary, LocaleLoader, LocaleLoaders } from './resources';

const BASE_SEGMENTS = import.meta.env.BASE_URL.split('/').filter(Boolean).length;

const CORE_LOCALES: LocaleLoaders = {
  ...loadersByLanguage(
    import.meta.glob<Dictionary>(['../locales/*.json', '!../locales/en.json'], {
      import: 'default',
    }),
  ),
  [DEFAULT_LANGUAGE]: () => Promise.resolve(en),
};

let loadDictionary: DictionaryLoader = createDictionaryLoader([CORE_LOCALES]);
let requestedLanguage: LanguageCode = DEFAULT_LANGUAGE;

async function addLanguage(code: LanguageCode): Promise<void> {
  if (i18next.hasResourceBundle(code, NAMESPACE)) return;
  i18next.addResourceBundle(code, NAMESPACE, await loadDictionary(code));
}

export async function initI18n(locales: LocaleLoaders = {}): Promise<void> {
  loadDictionary = createDictionaryLoader([CORE_LOCALES, locales]);
  const fallback = await loadDictionary(DEFAULT_LANGUAGE);
  await i18next.init({
    ...TRANSLATION_OPTIONS,
    lng: detectLanguage({ location, navigator, storage: () => localStorage }, BASE_SEGMENTS),
    resources: { [DEFAULT_LANGUAGE]: { [NAMESPACE]: fallback } },
    supportedLngs: LANGUAGES.map((language) => language.code),
    nonExplicitSupportedLngs: true,
  });
  await setLanguage(currentLanguage());
}

export const t = i18next.t.bind(i18next);

export function currentLanguage(): LanguageCode {
  return baseLanguage(i18next.language ?? DEFAULT_LANGUAGE) ?? DEFAULT_LANGUAGE;
}

export async function setLanguage(code: LanguageCode): Promise<void> {
  requestedLanguage = code;
  await addLanguage(code);
  if (code === requestedLanguage) await i18next.changeLanguage(code);
}

export function rememberLanguage(code: LanguageCode): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    return;
  }
}

export function onLanguageChanged(listener: (code: LanguageCode) => void): () => void {
  const handler = () => listener(currentLanguage());
  i18next.on('languageChanged', handler);
  return () => i18next.off('languageChanged', handler);
}
