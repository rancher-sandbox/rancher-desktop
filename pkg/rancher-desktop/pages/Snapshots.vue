<script lang="ts">
import Vue from 'vue';

import Snapshots from '@pkg/components/Snapshots.vue';

export default Vue.extend({
  components: { Snapshots },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      {
        title:  this.t('snapshots.title'),
        action: 'SnapshotsButtonCreate',
      },
    );
  },
});

</script>

<template>
  <div>
    <nuxt-child />
    <Snapshots
      class="snapshots-page"
    />
  </div>
</template>

<style lang="scss" scoped>
  .snapshots-page {
    padding-top: 13px;
  }
</style>
