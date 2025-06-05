<template>
  <div class="extensions-page">
    <rd-tabbed
      :active-tab="activeTab"
    >
      <tab
        data-test="extensions-tab-installed"
        :label="t('marketplace.tabs.installed')"
        name="extensions-installed"
        :weight="0"
        @active="tabActivate('extensions-installed')"
      />
      <tab
        data-test="extensions-tab-catalog"
        :label="t('marketplace.tabs.catalog')"
        name="marketplace-catalog"
        :weight="1"
        @active="tabActivate('marketplace-catalog')"
      />
      <div class="marketplace-container">
        <component
          :is="activeTab"
          @click:browse="tabActivate('marketplace-catalog')"
        />
      </div>
    </rd-tabbed>
  </div>
</template>

<script>

import MarketplaceCatalog from '@pkg/components/MarketplaceCatalog.vue';
import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';
import { defaultSettings } from '@pkg/config/settings';
import ExtensionsInstalled from '@pkg/pages/extensions/installed.vue';

export default {
  title:      'Marketplace',
  components: {
    RdTabbed,
    Tab,
    MarketplaceCatalog,
    ExtensionsInstalled,
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
      title:       this.t('marketplace.title'),
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

.marketplace-container {
  padding: 1rem 0.25rem;
}
</style>
