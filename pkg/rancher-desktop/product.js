export const NAME = 'rancher-desktop';

export function init(plugin, store) {
  const { product } = plugin.DSL(store, NAME);

  product({
    inStore:             'management',
    icon:                'globe',
    label:               'Rancher Desktop',
    removable:           false,
    showClusterSwitcher: false,
    category:            'global',
    to:                  { name: 'rancher-desktop-general' },
  });
}
