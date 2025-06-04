<script lang="ts">
import { Banner } from '@rancher/components';
import isEmpty from 'lodash/isEmpty';
import Vue from 'vue';
import { mapGetters } from 'vuex';

import EmptyState from '@pkg/components/EmptyState.vue';
import SnapshotCard from '@pkg/components/SnapshotCard.vue';
import { Snapshot, SnapshotEvent } from '@pkg/main/snapshots/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { escapeHtml } from '@pkg/utils/string';

interface Data {
  snapshotEvent: SnapshotEvent | null;
  snapshotsPollingInterval: ReturnType<typeof setInterval> | null;
  isEmpty: boolean;
}

interface Methods {
  pollingStart: () => void,
  escapeHtml: (name: string|undefined) => string,
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
    };
  },

  computed: { ...mapGetters('snapshots', { snapshots: 'list' }) },

  watch: {
    snapshots(list) {
      this.isEmpty = list?.length === 0;
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

    const {
      type, result, snapshotName, eventTime,
    } = this.$route.params as SnapshotEvent;

    this.snapshotEvent = {
      type, result, snapshotName, eventTime,
    };
  },

  beforeDestroy() {
    if (this.snapshotsPollingInterval) {
      clearInterval(this.snapshotsPollingInterval);
    }
    ipcRenderer.removeAllListeners('snapshot');
  },

  methods: {
    pollingStart() {
      this.snapshotsPollingInterval = setInterval(() => {
        this.$store.dispatch('snapshots/fetch');
      }, 1500);
    },
    escapeHtml,
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
        class="banner"
        :color="snapshotEvent.result"
        :closable="true"
        @close="snapshotEvent=null"
      >
        <span
          v-clean-html="t(`snapshots.info.${ snapshotEvent.type }.${ snapshotEvent.result }`,
                          { snapshot: escapeHtml(snapshotEvent.snapshotName), error: snapshotEvent.error }, true)"
          class="event-message"
        />
        <span
          v-clean-html="t('snapshots.info.when', { time: snapshotEvent.eventTime })"
          class="event-message"
        />
      </Banner>
    </div>
    <div
      class="cards"
      :class="{ margin: !snapshotEvent }"
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
      position: sticky;
      top: 0;
      background: var(--body-bg);

      .banner {
        margin: 0;
        :deep(.banner__content) {
          margin-top: 8px;
          margin-bottom: 15px;

          .banner__content__closer {
            height: 50px;
          }
        }
      }
    }

    .cards {
      &.margin {
        margin-top: 13px;
      }
      overflow-y: auto;
    }
  }
</style>
