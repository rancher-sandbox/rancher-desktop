<script lang="ts">
import { defineComponent } from 'vue';

import Snapshots from '@pkg/components/Snapshots.vue';

export default defineComponent({
  name:       'snapshots',
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
