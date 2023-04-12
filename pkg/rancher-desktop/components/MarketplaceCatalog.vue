<script lang="ts">
import Vue from 'vue';

import { demoMarketplace } from '../utils/_demo_marketplace_items.js';

import MarketplaceCard from '@pkg/components/MarketplaceCard.vue';

type FilteredExtensions = typeof demoMarketplace.summaries;

export default Vue.extend({
  name:       'marketplace-catalog',
  components: { MarketplaceCard },
  data() {
    return {
      searchValue: '',
      extensions:  demoMarketplace.summaries,
    };
  },
  computed: {
    filteredExtensions(): FilteredExtensions {
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
});
</script>

<template>
  <div>
    <input v-model="searchValue" type="text" placeholder="Search" />
    <div v-if="filteredExtensions.length === 0" class="extensions-content-missing">
      {{ t('marketplace.noResults') }}
    </div>
    <div class="extensions-content">
      <div
        v-for="item in filteredExtensions"
        :key="item.slug"
        :v-if="filteredExtensions"
      >
        <MarketplaceCard
          :extension="item"
          :data-test="`extension-card-${item.name.toLowerCase()}`"
        />
      </div>
    </div>
  </div>
</template>
