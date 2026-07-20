import { jest } from '@jest/globals';

import { availableLocales, t } from '@pkg/main/i18n';

describe('main-process i18n', () => {
  it('translates from the default locale', () => {
    expect(t('product.version')).toEqual('Version');
  });

  it('returns a visible %key% placeholder for a missing key', () => {
    expect(t('no.such.key')).toEqual('%no.such.key%');
  });

  it('interpolates arguments', () => {
    expect(t('mainMenu.help.about', { appName: 'Rancher Desktop' }))
      .toEqual('&About Rancher Desktop');
  });

  it('formats ICU plurals', () => {
    expect(t('sortableTable.paging.generic', { pages: 0 })).toEqual('No Items');
  });

  it('renders ICU quoted literals as visible quotes', () => {
    expect(t('dialog.invalidK8sVersion.message', { version: '1.32' }))
      .toEqual("Requested Kubernetes version '1.32' is not a supported version.");
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
