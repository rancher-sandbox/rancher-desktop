import { extensionThemes } from '../extension-themes';

/**
 * Extensions that bundle a fallback theme switch to ours as soon as it exists,
 * so a gap here breaks extensions that work without any theme at all.
 */
describe('extensionThemes', () => {
  const colors = ['amber', 'blue', 'green', 'grey', 'red', 'violet'] as const;
  const shades = [100, 200, 300, 400, 500, 600, 700, 800] as const;

  it.each(['light', 'dark'] as const)('describes the %s theme', (mode) => {
    expect(extensionThemes[mode].palette.mode).toEqual(mode);
  });

  it.each(colors)('gives %s every shade', (color) => {
    for (const bag of [extensionThemes.light, extensionThemes.dark]) {
      const ramp = bag.palette.docker[color];

      expect(Object.keys(ramp).map(Number).sort((a, b) => a - b)).toEqual([...shades]);
      for (const shade of shades) {
        expect(ramp[shade]).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });
});
