/**
 * Click handler for data-navigate attributes in translated HTML strings.
 * Parses "Page,tab" from the attribute and calls the navigate function.
 */
export function handleNavigateClick(
  event: MouseEvent,
  navigate: (navItem: string, tab?: string) => void,
): void {
  const target = (event.target as HTMLElement)?.closest('[data-navigate]');
  const nav = target?.getAttribute('data-navigate');

  if (nav) {
    // data-navigate values from translations are not validated against known
    // page names; malformed values produce a no-op navigation.
    const [navItem, tab] = nav.split(',');

    navigate(navItem, tab);
  }
}
