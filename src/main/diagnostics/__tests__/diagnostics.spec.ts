import yaml from 'yaml';

import { Diagnostics } from '../diagnostics';

describe(Diagnostics, () => {
  // This table looks a lot like diagnostics.yaml during early development,
  // but there's no need to update it as the yaml file changes. It's fine to
  // just leave it here as is.
  const diagnosticsTable = `
diagnostics:
  last_update: 2022-08-15T16:00+00:00
  categories:
    - title: Utilities
      checks:
        - id: RD_BIN_IN_BASH_PATH
          documentation: path#rd_bin_bash
          description: "The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your bash shell."
          mute: false
          fixes:
          - description: "You have selected manual PATH configuration. You can let Rancher Desktop automatically configure it."
        - id: RD_BIN_SYMLINKS
          documentation: path#rd_bin_symlinks
          description: "Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?"
          mute: false
          fixes:
          - description: "Replace existing files in ~/.rd/bin with symlinks to the application's internal utility directory"
    - title: Networking
      checks:
        - id: CONNECTED_TO_INTERNET
          documentation: path#connected_to_internet
          description: "The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate."
          mute: false
`;
  const diagnostics = new Diagnostics(yaml.parse(diagnosticsTable).diagnostics);

  test('it finds the categories', () => {
    expect(diagnostics.getCategoryNames()).toEqual(expect.arrayContaining(['Utilities', 'Networking']));
  });

  test('it finds the IDs', () => {
    expect(diagnostics.getIdsForCategory('Utilities')).toEqual(expect.arrayContaining(['RD_BIN_IN_BASH_PATH', 'RD_BIN_SYMLINKS']));
    expect(diagnostics.getIdsForCategory('Networking')).toEqual(expect.arrayContaining(['CONNECTED_TO_INTERNET']));
    expect(diagnostics.getIdsForCategory('Tennessee Tuxedo')).toBeUndefined();
  });

  test('it finds the checks', () => {
    expect(diagnostics.getChecks(null, null)).toEqual(expect.arrayContaining([
      {
        category:      'Utilities',
        id:            'RD_BIN_IN_BASH_PATH',
        documentation: 'path#rd_bin_bash',
        description:   'The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your bash shell.',
        mute:          false,
        fixes:         [
          { description: 'You have selected manual PATH configuration. You can let Rancher Desktop automatically configure it.' },
        ],
      },
      {
        category:      'Utilities',
        id:            'RD_BIN_SYMLINKS',
        documentation: 'path#rd_bin_symlinks',
        description:   'Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?',
        mute:          false,
        fixes:         [
          { description: 'Replace existing files in ~/.rd/bin with symlinks to the application\'s internal utility directory' },
        ],
      },
      {
        category:      'Networking',
        id:            'CONNECTED_TO_INTERNET',
        documentation: 'path#connected_to_internet',
        description:   'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
        mute:          false,
        fixes:         [],
      },
    ]));
    expect(diagnostics.getChecks('Chummily', 'CONNECTED_TO_INTERNET')).toEqual([]);
    expect(diagnostics.getChecks('Utilities', 'gallop the friendly purple')).toEqual([]);
    expect(diagnostics.getChecks('Utilities', 'RD_BIN_IN_BASH_PATH')).toMatchObject([{
      documentation: 'path#rd_bin_bash',
      description:   'The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your bash shell.',
      mute:          false,
      fixes:         [{ description: 'You have selected manual PATH configuration. You can let Rancher Desktop automatically configure it.' }],
    }]);
    expect(diagnostics.getChecks('Utilities', 'RD_BIN_SYMLINKS')).toMatchObject([{
      documentation: 'path#rd_bin_symlinks',
      description:   'Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?',
      mute:          false,
      fixes:         [{ description: "Replace existing files in ~/.rd/bin with symlinks to the application's internal utility directory" }],
    }]);
    const internetCheck = diagnostics.getChecks('Networking', 'CONNECTED_TO_INTERNET');

    expect(internetCheck[0]).toMatchObject({
      documentation: 'path#connected_to_internet',
      description:   'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
      mute:          false,
    });
    expect(internetCheck[0]).not.toMatchObject({ fixes: { description: expect.any(String) } });
  });
});
