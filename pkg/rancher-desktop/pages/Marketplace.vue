<template>
  <div class="extensions-page">
    <marketplace-catalog />
  </div>
</template>

<script>

import MarketplaceCatalog from '@pkg/components/MarketplaceCatalog.vue';
import { defaultSettings } from '@pkg/config/settings';

export default {
  title:      'Marketplace',
  components: { MarketplaceCatalog },
  data() {
    return {
      settings:           defaultSettings,
      imageNamespaces:    [],
      supportsNamespaces: true,
    };
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
