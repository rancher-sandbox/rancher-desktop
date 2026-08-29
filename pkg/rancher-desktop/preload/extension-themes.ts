/**
 * Theme options for Docker Desktop extension UIs.
 *
 * `@docker/docker-mui-theme` reads its themes from `window.__ddMuiV5Themes` and
 * `window.__ddMuiV6Themes`, which the host application has to provide; the
 * package itself ships no colours.  An extension built against it renders a
 * blank page when the host leaves those globals undefined.
 *
 * The bag has to carry `palette.docker` in full.  MUI adds that palette through
 * a module augmentation, so `createTheme()` cannot supply defaults for it the
 * way it does for `background`, `primary` and the rest, and extensions read it
 * directly (Docker's own logs-explorer wants `palette.docker.grey[600]`).  An
 * incomplete bag is worse than none at all.  Extensions carrying a bundled
 * fallback theme switch to ours the moment it exists, so leaving a colour out
 * breaks extensions that work today.
 */

/** A shade ramp, keyed by the weights the extension SDK's `CustomColor` declares. */
type ColorRamp = Record<100 | 200 | 300 | 400 | 500 | 600 | 700 | 800, string>;

interface ThemeOptions {
  palette: {
    mode:   'light' | 'dark';
    docker: Record<'amber' | 'blue' | 'green' | 'grey' | 'red' | 'violet', ColorRamp>;
  };
}

export interface ThemeOptionsBag {
  light: ThemeOptions;
  dark:  ThemeOptions;
}

/**
 * Colour ramps for `palette.docker`.  Docker Desktop puts its own brand colours
 * here; ours come from Rancher Desktop's stylesheets so extensions look like the
 * rest of the application.
 *
 * Each ramp runs from 100 (lightest) to 800 (darkest).  The seed colour sits at
 * 500 and is an existing Rancher Desktop colour; the steps above and below it
 * are mixes towards white and towards `$darkest` (#141419).  Origins:
 *
 * - `grey` needs no seed.  All eight shades are Rancher Desktop neutrals
 *   already, `$lighter` through `$darker` from `assets/styles/themes/_light.scss`
 *   and `$medium` through `$dark` from `_dark.scss`.
 * - `blue` is `$primary`, which `_light.scss` also uses for `$link` and `$info`.
 * - `green` is the SUSE brand green from `_suse.scss`, `hsl(151, 59%, 46%)`.
 *   `$success` (#5D995D) is the semantic green, but it reads muted next to the
 *   other ramps, and this palette is for branding rather than state.
 * - `amber` is `$warning`, `red` is `$error`.
 * - `violet` has no Rancher Desktop equivalent.  It is tuned to sit near `blue`
 *   in saturation so the family stays coherent.
 */
const dockerPalette: ThemeOptions['palette']['docker'] = {
  amber: {
    100: '#F8F4DD',
    200: '#F1E8B7',
    300: '#E9DB8E',
    400: '#E1CF68',
    500: '#DAC342',
    600: '#B6A43B',
    700: '#938433',
    800: '#6F642C',
  },
  blue: {
    100: '#DCECF7',
    200: '#B5D8EE',
    300: '#8BC1E5',
    400: '#64ADDC',
    500: '#3D98D3',
    600: '#3680B2',
    700: '#2E6890',
    800: '#27516F',
  },
  green: {
    100: '#DAF3E7',
    200: '#B0E5CC',
    300: '#83D6AE',
    400: '#59C993',
    500: '#30BB78',
    600: '#2B9D67',
    700: '#267F56',
    800: '#216145',
  },
  grey: {
    100: '#F4F5FA',
    200: '#EEEFF4',
    300: '#DCDEE7',
    400: '#B6B6C2',
    500: '#6C6C76',
    600: '#4A4B52',
    700: '#27292E',
    800: '#1B1C21',
  },
  red: {
    100: '#FDDEDE',
    200: '#FCB9B9',
    300: '#FA9191',
    400: '#F86C6C',
    500: '#F64747',
    600: '#CD3E3F',
    700: '#A53536',
    800: '#7C2B2E',
  },
  violet: {
    100: '#EAE5F5',
    200: '#D3C8EA',
    300: '#B9A9DF',
    400: '#A28CD4',
    500: '#8B6FC9',
    600: '#765FA9',
    700: '#604E8A',
    800: '#4B3E6A',
  },
};

/**
 * The themes to expose as both `__ddMuiV5Themes` and `__ddMuiV6Themes`.  MUI
 * accepts the same options in either version, so one definition serves both.
 * `@docker/docker-mui-theme` picks the entry matching `prefers-color-scheme`,
 * which the extension's view already reports from the application theme, and
 * `createTheme()` fills in everything we leave out.
 */
export const extensionThemes: ThemeOptionsBag = {
  light: { palette: { mode: 'light', docker: dockerPalette } },
  dark:  { palette: { mode: 'dark', docker: dockerPalette } },
};
