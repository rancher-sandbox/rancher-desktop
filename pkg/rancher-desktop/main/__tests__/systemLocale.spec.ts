/** @jest-environment node */

import { jest } from '@jest/globals';

import mockModules from '@pkg/utils/testUtils/mockModules';

let preferredLanguages: string[] = [];
let systemLocale = '';
let applicationLocale = '';

mockModules({
  electron: {
    app: {
      getPreferredSystemLanguages: () => preferredLanguages,
      getSystemLocale:             () => systemLocale,
      getLocale:                   () => applicationLocale,
    },
  },
});

const { getSystemLocale } = await import('@pkg/main/systemLocale');

describe('getSystemLocale', () => {
  beforeEach(() => {
    preferredLanguages = [];
    systemLocale = '';
    applicationLocale = '';
  });

  it('uses the first supported preferred language', () => {
    preferredLanguages = ['nl-NL', 'pt-BR', 'en-US'];

    expect(getSystemLocale()).toBe('pt-br');
  });

  it('falls back to the system locale', () => {
    systemLocale = 'vi_VN';

    expect(getSystemLocale()).toBe('vi');
  });

  it('falls back to the application locale', () => {
    applicationLocale = 'zh-TW';

    expect(getSystemLocale()).toBe('zh-hans');
  });

  it('falls back to en-us when no language is supported', () => {
    preferredLanguages = ['nl-NL'];
    systemLocale = 'sv-SE';
    applicationLocale = 'nb-NO';

    expect(getSystemLocale()).toBe('en-us');
  });
});
