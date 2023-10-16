<script lang="ts">
import { Banner } from '@rancher/components';
import isEmpty from 'lodash/isEmpty';
import Vue from 'vue';
import { mapGetters } from 'vuex';

import EmptyState from '@pkg/components/EmptyState.vue';
import SnapshotCard from '@pkg/components/SnapshotCard.vue';
import { Snapshot, SnapshotEvent } from '@pkg/main/snapshots/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

interface Data {
  snapshotEvent: SnapshotEvent | null;
  snapshotsPollingInterval: ReturnType<typeof setInterval> | null;
  isEmpty: boolean;
  cardsStyle: string;
}

interface Methods {
  pollingStart: () => void,
  adjustCardsHeight: () => void;
  toggleMainScrollbar: (value: boolean) => void;
}

interface Computed {
  snapshots: Snapshot[],
}

export default Vue.extend<Data, Methods, Computed, never>({
  components: {
    Banner,
    EmptyState,
    SnapshotCard,
  },

  data(): Data {
    return {
      snapshotsPollingInterval: null,
      snapshotEvent:            null,
      isEmpty:                  false,
      cardsStyle:               '',
    };
  },

  computed: { ...mapGetters('snapshots', { snapshots: 'list' }) },

  watch: {
    snapshots(list) {
      this.isEmpty = list?.length === 0;
    },
    snapshotEvent: {
      handler() {
        this.adjustCardsHeight();
      },
    },
  },

  beforeMount() {
    this.$store.dispatch('snapshots/fetch');
    this.pollingStart();

    ipcRenderer.on('snapshot', (_, event) => {
      this.snapshotEvent = event;
    });

    if (isEmpty(this.$route.params)) {
      return;
    }

    const { type, result, snapshotName } = this.$route.params as SnapshotEvent;

    this.snapshotEvent = {
      type, result, snapshotName,
    };
  },

  mounted() {
    this.toggleMainScrollbar(false);
    this.adjustCardsHeight();
    addEventListener('resize', this.adjustCardsHeight);
  },

  beforeDestroy() {
    if (this.snapshotsPollingInterval) {
      clearInterval(this.snapshotsPollingInterval);
    }
    ipcRenderer.removeAllListeners('snapshot');
    removeEventListener('resize', this.adjustCardsHeight);
    this.toggleMainScrollbar(true);
  },

  methods: {
    pollingStart() {
      this.snapshotsPollingInterval = setInterval(() => {
        this.$store.dispatch('snapshots/fetch');
      }, 1500);
    },
    adjustCardsHeight() {
      this.cardsStyle = `height: ${ window?.innerHeight - 150 - (this.snapshotEvent ? 75 : 0) }px`;
    },
    toggleMainScrollbar(value: boolean) {
      const main = document.getElementsByTagName('main')?.[0];

      if (main) {
        main.style.overflowY = value ? 'auto' : 'hidden';
      }
    },
  },
});
</script>

<template>
  <div class="snapshots">
    <div
      v-if="snapshotEvent"
      class="event"
    >
      <Banner
        class="banner mb-20"
        :color="snapshotEvent.result"
        :closable="true"
        @close="snapshotEvent=null"
      >
        <span
          class="event-message"
          v-html="t(`snapshots.info.${ snapshotEvent.type }.${ snapshotEvent.result }`, { snapshot: snapshotEvent.snapshotName, error: snapshotEvent.error }, true)"
        />
      </Banner>
    </div>
    <div
      :style="cardsStyle"
      class="cards"
    >
      <div
        v-for="(item) of snapshots"
        :key="item.name"
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
  </div>
</template>

<style lang="scss" scoped>
  .event-message {
    word-wrap: break-word;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .snapshots {
    > * {
      padding: 0 5px 0 5px;
    }

    .event {
      margin-top: 0;
    }

    .cards {
      margin-top: 13px;
      overflow-y: auto;
    }
  }
</style>
