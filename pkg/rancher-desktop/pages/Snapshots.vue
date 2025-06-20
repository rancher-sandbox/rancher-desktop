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
    <RouterView />
    <Snapshots
      data-test="snapshotsPage"
      class="snapshots-page"
    />
  </div>
</template>
