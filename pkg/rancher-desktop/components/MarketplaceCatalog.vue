<script lang="ts">
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import MarketplaceCard from '@pkg/components/MarketplaceCard.vue';
import { ContainerEngine } from '@pkg/config/settings';
import type { ExtensionState, MarketplaceData } from '@pkg/store/extensions';

type ExtensionData = MarketplaceData;

export default defineComponent({
  name:       'marketplace-catalog',
  components: { MarketplaceCard },
  data() {
    return { searchValue: '' };
  },
  computed: {
    ...mapGetters('preferences', ['getPreferences']),
    ...mapGetters('extensions', ['installedExtensions', 'marketData']) as {
      installedExtensions: () => ExtensionState[],
      marketData: () => MarketplaceData[],
    },
    containerEngine(): string {
      return this.getPreferences.containerEngine.name;
    },
    isMobyActive(): boolean {
      return this.containerEngine === ContainerEngine.MOBY;
    },
    allowedListEnabled(): boolean {
      return this.getPreferences.application.extensions.allowed.enabled;
    },
    allowedExtensions(): string[] {
      return this.getPreferences.application.extensions.allowed.list;
    },
    filteredExtensions(): ExtensionData[] {
      let tempExtensions = this.marketData
        .filter((item) => {
          return this.isAllowed(item.slug);
        });

      if (this.searchValue) {
        tempExtensions = tempExtensions.filter((item) => {
          return item.title
            .toLowerCase()
            .includes(this.searchValue.toLowerCase());
        });
      }
      const filteredExtensions = tempExtensions.filter(item => this.isMobyActive || item.containerd_compatible);
      const collator = new Intl.Collator('en', { sensitivity: 'base' });

      return filteredExtensions.sort((s1, s2) => {
        return collator.compare(s1.title, s2.title);
      });
    },
  },
  methods: {
    installedVersion(slug: string) {
      return this.installedExtensions.find(item => item.id === slug)?.version;
    },
    isAllowed(slug: string) {
      return !this.allowedListEnabled || this.allowedExtensions.includes(slug);
    },
    installedExtension(slug: string) {
      return this.installedExtensions.find(item => item.id === slug);
    },
  },
});
</script>

<template>
  <div>
    <input
      v-model="searchValue"
      type="text"
      placeholder="Search"
    />
    <div
      v-if="filteredExtensions.length === 0"
      class="extensions-content-missing"
    >
      {{ t('marketplace.noResults') }}
    </div>
    <div
      class="extensions-content"
    >
      <div
        v-for="item in filteredExtensions"
        :key="item.slug"
        :v-if="filteredExtensions"
      >
        <MarketplaceCard
          :extension="item"
          :installed="installedExtension(item.slug)"
          :data-test="`extension-card-${item.title.toLowerCase()}`"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.extensions-content {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  margin-top: 20px;
}
</style>
