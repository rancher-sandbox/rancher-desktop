<template>
  <div class="extensions-page">
    <nuxt-child />
    <input v-model="searchValue" type="text" placeholder="Search" />
    <div v-if="filteredExtensions.length === 0" class="extensions-content-missing">
      {{ t('marketplace.noResults') }}
    </div>
    <div class="extensions-content">
      <div v-for="item in filteredExtensions" :key="item.slug" :v-if="filteredExtensions">
        <MarketplaceCard :extension="item" />
      </div>
    </div>
  </div>
</template>

<script>
import { demoMarketplace } from '../utils/_demo_marketplace_items.js';

import MarketplaceCard from '@pkg/components/MarketplaceCard.vue';
import { defaultSettings } from '@pkg/config/settings';

export default {
  components: { MarketplaceCard },
  title:      'Marketplace',
  data() {
    return {
      settings:           defaultSettings,
      extensions:         demoMarketplace.summaries.slice(0, 2),
      imageNamespaces:    [],
      supportsNamespaces: true,
      searchValue:        '',
    };
  },
  computed: {
    filteredExtensions() {
      let tempExtensions = this.extensions;

      if (this.searchValue) {
        tempExtensions = tempExtensions.filter((item) => {
          return item.name
            .toLowerCase()
            .includes(this.searchValue.toLowerCase());
        });
      }

      return tempExtensions;
    },
  },
  mounted() {
    this.$store.dispatch('page/setHeader', {
      title:       'Marketplace',
      description: '',
    });
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
