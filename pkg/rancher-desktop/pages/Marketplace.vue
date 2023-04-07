<template>
  <div class="extensions-page">
    <rd-tabbed>
      <tab
        label="Installed"
        name="installed"
        :weight="0"
        @active="tabActivate('extensions-installed')"
      />
      <tab
        label="Catalog"
        name="catalog"
        :weight="1"
        @active="tabActivate('marketplace-catalog')"
      />
      <component :is="activeTab" />
    </rd-tabbed>
  </div>
</template>

<script>

import MarketplaceCatalog from '@pkg/components/MarketplaceCatalog.vue';
import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';
import { defaultSettings } from '@pkg/config/settings';
import { withCredentials } from '@pkg/hocs/withCredentials';
import ExtensionsInstalled from '@pkg/pages/extensions/installed.vue';

const ExtensionsInstalledWithCredentials = withCredentials(ExtensionsInstalled);
const MarketplaceCatalogWithCredentials = withCredentials(MarketplaceCatalog);

export default {
  title:      'Marketplace',
  components: {
    RdTabbed,
    Tab,
    MarketplaceCatalog:  MarketplaceCatalogWithCredentials,
    ExtensionsInstalled: ExtensionsInstalledWithCredentials,
  },
  data() {
    return {
      settings:           defaultSettings,
      imageNamespaces:    [],
      supportsNamespaces: true,
      activeTab:          'marketplace-catalog',
    };
  },
  mounted() {
    this.$store.dispatch('page/setHeader', {
      title:       'Marketplace',
      description: '',
    });
  },
  methods: {
    tabActivate(tab) {
      this.activeTab = tab;
    },
  },
};
</script>

<style lang="scss" scoped>
.extensions-content {
  display: grid;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 1.5rem;

  &-missing {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
    // font-size: 1.5rem;
  }
}
</style>
