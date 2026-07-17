import { jest } from '@jest/globals';

import { availableLocales, t } from '@pkg/main/i18n';

describe('main-process i18n', () => {
  it('translates from the default locale', () => {
    expect(t('generic.cancel')).toEqual('Cancel');
  });

  it('returns a visible %key% placeholder for a missing key', () => {
    expect(t('no.such.key')).toEqual('%no.such.key%');
  });

  it('formats ICU plurals', () => {
    expect(t('sortableTable.paging.generic', { pages: 0 })).toEqual('No Items');
  });

  it('degrades to the raw pattern when an argument is missing', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(t('sortableTable.paging.generic', {})).toContain('{pages,');
    spy.mockRestore();
  });

  it('lists the bundled locales', () => {
    expect(availableLocales).toEqual(expect.arrayContaining(['en-us']));
  });
});
