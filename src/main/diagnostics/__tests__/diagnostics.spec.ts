import { DiagnosticsManager, DiagnosticsCategory, DiagnosticsChecker, DiagnosticsResult } from '../diagnostics';

describe(DiagnosticsManager, () => {
  const mockDiagnostics: DiagnosticsChecker[] = [
    {
      id:            'RD_BIN_IN_BASH_PATH',
      category:      DiagnosticsCategory.Utilities,
      check:         () => Promise.resolve({
        documentation: 'path#rd_bin_bash',
        description:   'The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your bash shell.',
        passed:        true,
        fixes:         [],
      }),
    },
    {
      id:            'RD_BIN_SYMLINKS',
      category:      DiagnosticsCategory.Utilities,
      check:         () => Promise.resolve({
        documentation: 'path#rd_bin_symlinks',
        description:   'Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?',
        passed:        false,
        fixes:         [],
      }),
    },
    {
      id:            'CONNECTED_TO_INTERNET',
      category:      DiagnosticsCategory.Networking,
      check:         () => Promise.resolve({
        documentation: 'path#connected_to_internet',
        description:   'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
        passed:        false,
        fixes:         [],
      }),
    },
  ];
  const diagnostics = new DiagnosticsManager(mockDiagnostics);

  test('it finds the categories', () => {
    expect(diagnostics.getCategoryNames()).toEqual(expect.arrayContaining(['Utilities', 'Networking']));
  });

  test('it finds the IDs', () => {
    expect(diagnostics.getIdsForCategory('Utilities')).toEqual(expect.arrayContaining(['RD_BIN_IN_BASH_PATH', 'RD_BIN_SYMLINKS']));
    expect(diagnostics.getIdsForCategory('Networking')).toEqual(expect.arrayContaining(['CONNECTED_TO_INTERNET']));
    expect(diagnostics.getIdsForCategory('Tennessee Tuxedo')).toBeUndefined();
  });

  test('it finds the checks', async() => {
    await expect(diagnostics.runChecks()).resolves.toEqual(({
      last_update: expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/),
      checks:      expect.arrayContaining<DiagnosticsResult>([
        {
          id:            mockDiagnostics[0].id,
          category:      mockDiagnostics[0].category,
          documentation: 'path#rd_bin_bash',
          description:   'The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your bash shell.',
          passed:        true,
          mute:          false,
          fixes:         [
          // { description: 'You have selected manual PATH configuration. You can let Rancher Desktop automatically configure it.' },
          ],
        },
        {
          id:            mockDiagnostics[1].id,
          category:      mockDiagnostics[1].category,
          documentation: 'path#rd_bin_symlinks',
          description:   'Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?',
          passed:        false,
          mute:          false,
          fixes:         [
          // { description: 'Replace existing files in ~/.rd/bin with symlinks to the application\'s internal utility directory' },
          ],
        },
        {
          id:            mockDiagnostics[2].id,
          category:      mockDiagnostics[2].category,
          documentation: 'path#connected_to_internet',
          description:   'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
          passed:        false,
          mute:          false,
          fixes:         [],
        },
      ]),
    }));
    expect(diagnostics.getChecks('Chummily', 'CONNECTED_TO_INTERNET')).toMatchObject({ checks: [] });
    expect(diagnostics.getChecks('Utilities', 'gallop the friendly purple')).toMatchObject({ checks: [] });
    expect(diagnostics.getChecks('Utilities', 'RD_BIN_IN_BASH_PATH')).toMatchObject({
      checks: [{
        documentation: 'path#rd_bin_bash',
        description:   'The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your bash shell.',
        mute:          false,
        fixes:         [/* { description: 'You have selected manual PATH configuration. You can let Rancher Desktop automatically configure it.' } */],
      }],
    });
    expect(diagnostics.getChecks('Utilities', 'RD_BIN_SYMLINKS')).toMatchObject({
      checks: [{
        documentation: 'path#rd_bin_symlinks',
        description:   'Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?',
        mute:          false,
        fixes:         [/* { description: "Replace existing files in ~/.rd/bin with symlinks to the application's internal utility directory" } */],
      }],
    });
    const internetCheck = diagnostics.getChecks('Networking', 'CONNECTED_TO_INTERNET').checks;

    expect(internetCheck[0]).toMatchObject({
      documentation: 'path#connected_to_internet',
      description:   'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
      mute:          false,
    });
    expect(internetCheck[0]).not.toMatchObject({ fixes: { description: expect.any(String) } });
  });
});
