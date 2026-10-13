import { DEFAULT_LANGUAGE, isLanguageCode } from './languages';
import type { LanguageCode } from './languages';
import { LANGUAGE_QUERY_KEY } from './paths';
import { LANGUAGE_STORAGE_KEY } from './redirect';

export interface DetectionEnvironment {
  location: { pathname: string; search: string; hash: string };
  navigator: { languages: readonly string[]; language: string };
  storage(): { getItem(key: string): string | null };
}

const PATH_SEGMENT = /\/([a-zA-Z-]*)/g;

function pathLanguage({ pathname }: DetectionEnvironment['location'], index: number) {
  return pathname.match(PATH_SEGMENT)?.[index]?.slice(1);
}

function queryLanguage({ search, hash }: DetectionEnvironment['location']) {
  const query = search || (hash.includes('?') ? hash.slice(hash.indexOf('?')) : '');
  return new URLSearchParams(query).getAll(LANGUAGE_QUERY_KEY).pop();
}

function storedLanguage(environment: DetectionEnvironment) {
  try {
    return environment.storage().getItem(LANGUAGE_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function supportedLanguage(code: string | undefined): LanguageCode | undefined {
  if (!code) return undefined;
  const [base] = code.split('-');
  const language = code.includes('-') ? base.toLowerCase() : base;
  return isLanguageCode(language) ? language : undefined;
}

export function detectLanguage(environment: DetectionEnvironment, pathIndex: number): LanguageCode {
  const candidates = [
    pathLanguage(environment.location, pathIndex),
    queryLanguage(environment.location),
    storedLanguage(environment),
    ...environment.navigator.languages,
    environment.navigator.language,
  ];
  for (const candidate of candidates) {
    const language = supportedLanguage(candidate);
    if (language) return language;
  }
  return DEFAULT_LANGUAGE;
}
