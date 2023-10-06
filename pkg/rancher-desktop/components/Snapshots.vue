<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';

import SnapshotCard from '@pkg/components/SnapshotCard.vue';

interface Data {
  snapshotsPollingInterval: ReturnType<typeof setInterval> | undefined;
}

interface VuexBindings {
  snapshots: Snapshot[]
}

export default (Vue as VueConstructor<Vue & VuexBindings>).extend({
  components: { SnapshotCard },

  data(): Data {
    return { snapshotsPollingInterval: null };
  },

  computed: { ...mapGetters('snapshots', { snapshots: 'list' }) },

  watch: {
    snapshots: {
      handler(neu) {
        this.$emit('change', neu);
      },
      immediate: true,
    },
  },

  beforeMount() {
    this.$store.dispatch('snapshots/fetch');
    this.pollingStart();
  },

  beforeDestroy() {
    clearInterval(this.snapshotsPollingInterval);
  },

  methods: {
    pollingStart() {
      this.snapshotsPollingInterval = setInterval(() => {
        this.$store.dispatch('snapshots/fetch');
      }, 1500);
    },
  },
});
</script>

<template>
  <div class="snapshots">
    <div
      v-for="item of snapshots"
      :key="item.id"
    >
      <SnapshotCard
        class="mb-20"
        :value="item"
      />
    </div>
  </div>
</template>
