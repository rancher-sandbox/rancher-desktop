import yaml from 'yaml';

import { Diagnostics } from '../diagnostics';

describe(Diagnostics, () => {
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
            description: "You have selected manual PATH configuration, you can let Rancher Desktop automatically configure it."
        - id: RD_BIN_SYMLINKS
          documentation: path#rd_bin_symlinks
          description: "Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?"
          mute: false
          fixes:
            description: "Replace existing files in ~/.rd/bin with symlinks to the application's internal utility directory"
    - title: Networking
      checks:
        - id: CONNECTED_TO_INTERNET
          documentation: path#connected_to_internet
          description: "The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate."
          mute: false
`;
  const diagnostics = new Diagnostics(yaml.parse(diagnosticsTable).diagnostics);

  test('it finds the categories', () => {
    expect(diagnostics.getCategoryNames()).toMatchObject(['Utilities', 'Networking']);
  });

  test('it finds the IDs', () => {
    expect(diagnostics.getIdsForCategory('Utilities')).toMatchObject(['RD_BIN_IN_BASH_PATH', 'RD_BIN_SYMLINKS']);
    expect(diagnostics.getIdsForCategory('Networking')).toMatchObject(['CONNECTED_TO_INTERNET']);
    expect(diagnostics.getIdsForCategory('Tennessee Tuxedo')).toBeUndefined();
  });

  test('it finds the checks', () => {
    expect(diagnostics.getCheckByID('Chummily', 'CONNECTED_TO_INTERNET')).toBeUndefined();
    expect(diagnostics.getCheckByID('Utilities', 'gallop the friendly purple')).toBeUndefined();
    expect(diagnostics.getCheckByID('Utilities', 'RD_BIN_IN_BASH_PATH')).toMatchObject({
      documentation: 'path#rd_bin_bash',
      description:   'The ~/.rd/bin directory has not been added to the PATH, so command-line utilities are not configured in your bash shell.',
      mute:          false,
      fixes:         { description: 'You have selected manual PATH configuration, you can let Rancher Desktop automatically configure it.' },
    });
    expect(diagnostics.getCheckByID('Utilities', 'RD_BIN_SYMLINKS')).toMatchObject({
      documentation: 'path#rd_bin_symlinks',
      description:   'Are the files under ~/.docker/cli-plugins symlinks to ~/.rd/bin?',
      mute:          false,
      fixes:         { description: "Replace existing files in ~/.rd/bin with symlinks to the application's internal utility directory" },
    });
    const internetCheck = diagnostics.getCheckByID('Networking', 'CONNECTED_TO_INTERNET');

    expect(internetCheck).toMatchObject({
      documentation: 'path#connected_to_internet',
      description:   'The application cannot reach the general internet for updated kubernetes versions and other components, but can still operate.',
      mute:          false,
    });
    expect(internetCheck).not.toMatchObject({ fixes: { description: expect.any(String) } });
  });
});
