<script lang="ts">
import Vue, { VueConstructor } from 'vue';
import { mapGetters } from 'vuex';

import { demoMarketplace } from '../utils/_demo_marketplace_items.js';

import MarketplaceCard from '@pkg/components/MarketplaceCard.vue';
import { Settings, ContainerEngine } from '@pkg/config/settings';
import { ExtensionState } from '~/store/extensions.js';
type FilteredExtensions = typeof demoMarketplace.summaries;

interface installedExtensions extends ExtensionState {
  id: string
}

interface VuexBindings {
  getPreferences: Settings;
}

export default (Vue as VueConstructor<Vue & VuexBindings>).extend({
  name:       'marketplace-catalog',
  components: { MarketplaceCard },
  data() {
    return {
      searchValue: '',
      loading:     true,
      credentials: {
        user:     '',
        password: '',
        port:     0,
      },
      extensions:          demoMarketplace.summaries,
      installedExtensions: [] as installedExtensions[],
    };
  },
  async fetch() {
    this.credentials = await this.$store.dispatch(
      'credentials/fetchCredentials',
    );

    if (!this.credentials) {
      return;
    }

    await this.$store.dispatch('extensions/fetch');

    this.loading = false;
  },
  computed: {
    ...mapGetters('preferences', ['getPreferences']),
    ...mapGetters('extensions', ['foo']),
    containerEngine(): string {
      return this.getPreferences.containerEngine.name;
    },
    isMobyActive(): boolean {
      return this.containerEngine === ContainerEngine.MOBY;
    },
    filteredExtensions(): FilteredExtensions {
      let tempExtensions = this.extensions;

      tempExtensions = tempExtensions.map((item) => {
        if (this.isInstalled(item.slug)) {
          return {
            ...item,
            installed: true,
          };
        }

        return {
          ...item,
          installed: false,
        };
      });

      if (this.searchValue) {
        tempExtensions = tempExtensions.filter((item) => {
          return item.name
            .toLowerCase()
            .includes(this.searchValue.toLowerCase());
        });
      }

      return tempExtensions.filter(item => this.isMobyActive || item.containerd_compatible);
    },
  },
  methods: {
    isInstalled(slug: string) {
      this.installedExtensions = this.$store.getters['extensions/list'];

      return this.installedExtensions.find(item => item?.id === slug);
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
    <div v-if="!loading" class="extensions-content">
      <div
        v-for="item in filteredExtensions"
        :key="item.slug"
        :v-if="filteredExtensions"
      >
        <MarketplaceCard
          :extension="item"
          :revalidate-state="isInstalled"
          :data-test="`extension-card-${item.name.toLowerCase()}`"
          :is-installed="item.installed"
          :credentials="credentials"
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
