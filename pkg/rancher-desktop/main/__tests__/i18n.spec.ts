import { jest } from '@jest/globals';

import mainEvents from '@pkg/main/mainEvents';

// Relative import bypasses any module mapping so the real module is tested.
const i18n = await import('../i18n');

describe('main-process i18n', () => {
  it('translates from the default locale', () => {
    expect(i18n.t('generic.cancel')).toEqual('Cancel');
  });

  it('returns a visible %key% placeholder for a missing key', () => {
    expect(i18n.t('no.such.key')).toEqual('%no.such.key%');
  });

  it('formats ICU plurals', () => {
    expect(i18n.t('sortableTable.paging.generic', { pages: 0 })).toEqual('No Items');
  });

  it('degrades to the raw pattern when an argument is missing', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(i18n.t('sortableTable.paging.generic', {})).toContain('{pages,');
    spy.mockRestore();
  });

  it('lists the bundled locales', () => {
    expect(i18n.availableLocales).toEqual(expect.arrayContaining(['en-us']));
  });
});
