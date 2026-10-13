import { describe, expect, it } from 'vitest';
import { detectLanguage } from './detect';
import type { DetectionEnvironment } from './detect';

interface Visit {
  pathname?: string;
  search?: string;
  hash?: string;
  stored?: string | null;
  languages?: readonly string[];
  language?: string;
}

function environment(visit: Visit): DetectionEnvironment {
  return {
    location: {
      pathname: visit.pathname ?? '/glider/',
      search: visit.search ?? '',
      hash: visit.hash ?? '',
    },
    navigator: { languages: visit.languages ?? [], language: visit.language ?? '' },
    storage: () => ({ getItem: () => visit.stored ?? null }),
  };
}

const throwingStorage = (visit: Visit): DetectionEnvironment => ({
  ...environment(visit),
  storage: () => {
    throw new Error('storage is blocked');
  },
});

describe('detectLanguage', () => {
  it.each<[string, Visit, number, string]>([
    ['reads the language folder of the path', { pathname: '/uk/glider/' }, 0, 'uk'],
    ['reads the folder after the base path', { pathname: '/site/de/glider/' }, 1, 'de'],
    ['reads the language query', { search: '?lang=fr' }, 0, 'fr'],
    ['reads the language query after a hash', { hash: '#top?lang=ja' }, 0, 'ja'],
    ['reads the stored language', { stored: 'es' }, 0, 'es'],
    ['reads the browser languages', { languages: ['ja', 'de'] }, 0, 'ja'],
    ['reads the browser language', { language: 'zh' }, 0, 'zh'],
    [
      'lets the path win over the query, storage and browser',
      { pathname: '/uk/glider/', search: '?lang=fr', stored: 'es', languages: ['de'] },
      0,
      'uk',
    ],
    [
      'lets the query win over storage and browser',
      { search: '?lang=fr', stored: 'es', languages: ['de'] },
      0,
      'fr',
    ],
    ['lets storage win over the browser', { stored: 'es', languages: ['de'] }, 0, 'es'],
    ['skips a path folder that is no language', { pathname: '/glider/', stored: 'pt' }, 0, 'pt'],
    ['skips an unsupported browser language', { languages: ['ko', 'de'] }, 0, 'de'],
    ['matches a region to its language', { languages: ['pt-BR'] }, 0, 'pt'],
    ['matches a script and region to its language', { languages: ['zh-Hans-CN'] }, 0, 'zh'],
    ['matches a region written in capitals', { languages: ['PT-br'] }, 0, 'pt'],
    ['falls back to English without a supported language', { languages: ['ko'] }, 0, 'en'],
    ['falls back to English with nothing to read', {}, 0, 'en'],
  ])('%s', (_case, visit, pathIndex, expected) => {
    expect(detectLanguage(environment(visit), pathIndex)).toBe(expected);
  });

  it('reads the browser when storage throws', () => {
    expect(detectLanguage(throwingStorage({ languages: ['uk'] }), 0)).toBe('uk');
  });
});
