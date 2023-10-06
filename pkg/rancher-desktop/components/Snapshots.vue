<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';

import EmptyState from '@pkg/components/EmptyState.vue';
import SnapshotCard from '@pkg/components/SnapshotCard.vue';
import { Snapshot } from '@pkg/main/snapshots/types';

interface Data {
  snapshotsPollingInterval: ReturnType<typeof setInterval> | null;
  isEmpty: boolean;
}

interface Methods {
  pollingStart: () => void,
}

interface Computed {
  snapshots: Snapshot[]
}

export default Vue.extend<Data, Methods, Computed, never>({
  components: { EmptyState, SnapshotCard },

  data(): Data {
    return {
      snapshotsPollingInterval: null,
      isEmpty:                  false,
    };
  },

  computed: { ...mapGetters('snapshots', { snapshots: 'list' }) },

  watch: {
    snapshots: {
      handler(neu) {
        this.isEmpty = neu?.length === 0;
        this.$emit('change', neu);
      },
    },
  },

  beforeMount() {
    this.$store.dispatch('snapshots/fetch');
    this.pollingStart();
  },

  beforeDestroy() {
    if (this.snapshotsPollingInterval) {
      clearInterval(this.snapshotsPollingInterval);
    }
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
    <div v-if="isEmpty">
      <empty-state
        class="mt-10"
        :icon="t('snapshots.empty.icon')"
        :heading="t('snapshots.empty.heading')"
        :body="t('snapshots.empty.body')"
      >
      </empty-state>
    </div>
  </div>
</template>
