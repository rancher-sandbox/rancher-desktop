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
      loading:     true,
      credentials: {
        user:     '',
        password: '',
        port:     0,
      },
      extensions:          demoMarketplace.summaries,
      installedExtensions: {},
    };
  },
  async fetch() {
    this.credentials = await this.$store.dispatch(
      'credentials/fetchCredentials',
    );

    if (!this.credentials) {
      return;
    }

    fetch(`http://localhost:${ this.credentials?.port }/v1/extensions`, {
      headers: new Headers({
        Authorization: `Basic ${ window.btoa(
          `${ this.credentials?.user }:${ this.credentials?.password }`,
        ) }`,
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
    }).then((response) => {
      if (!response.ok) {
        return;
      }

      response.json().then((res) => {
        this.installedExtensions = res;
        this.loading = false;
      });
    });
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
  methods: {
    isInstalled(slug: string) {
      return Object.keys(this.installedExtensions).includes(slug);
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
          :data-test="`extension-card-${item.name.toLowerCase()}`"
          :is-installed="isInstalled(item.slug)"
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
