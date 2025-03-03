<script lang="ts">
import semver from 'semver';
import Vue, { VueConstructor } from 'vue';
import { mapGetters } from 'vuex';

import MarketplaceCard from '@pkg/components/MarketplaceCard.vue';
import { Settings, ContainerEngine } from '@pkg/config/settings';
import { ExtensionState, MarketplaceData } from '@pkg/store/extensions.js';

type ExtensionData = MarketplaceData & { installed: boolean };

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
    };
  },
  async fetch() {
    this.credentials = await this.$store.dispatch(
      'credentials/fetchCredentials',
    );

    if (!this.credentials) {
      return;
    }

    this.loading = false;
  },
  computed: {
    ...mapGetters('preferences', ['getPreferences']),
    ...mapGetters('extensions', { installedExtensions: 'list', extensions: 'marketData' }) as {
        installedExtensions: () => ({ id: string } & ExtensionState )[],
        extensions: () => MarketplaceData[],
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
      let tempExtensions = this.extensions
        .filter((item) => {
          return this.isAllowed(item.slug);
        })
        .map((item) => {
          return {
            ...item,
            installed: this.isInstalled(item.slug),
          };
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
    isInstalled(slug: string) {
      return !!this.installedExtensions.find(item => item?.id === slug);
    },
    isOutdated(slug: string) {
      const available = this.extensions.find(item => item.slug === slug);
      const installed = this.installedExtensions.find(item => item?.id === slug);

      return available && installed && semver.gt(available.version, installed.version);
    },
    installedVersion(slug: string) {
      return this.installedExtensions.find(item => item.id === slug)?.version;
    },
    isAllowed(slug: string) {
      return !this.allowedListEnabled || this.allowedExtensions.includes(slug);
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
      v-if="!loading"
      class="extensions-content"
    >
      <div
        v-for="item in filteredExtensions"
        :key="item.slug"
        :v-if="filteredExtensions"
      >
        <MarketplaceCard
          :extension="item"
          :data-test="`extension-card-${item.title.toLowerCase()}`"
          :is-installed="item.installed"
          :installed-version="installedVersion(item.slug)"
          :credentials="credentials"
          @update:extension="isInstalled"
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
