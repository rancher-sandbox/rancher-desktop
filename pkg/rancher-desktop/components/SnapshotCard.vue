<script lang="ts">
import dayjs from 'dayjs';
import Vue from 'vue';

import { Snapshot } from '@pkg/main/snapshots/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

import type { PropType } from 'vue';

function formatDate(value: string) {
  if (!value) {
    return 'n/a';
  }

  return dayjs(value).format('YYYY-MM-DD HH:mm');
}

interface Data {
  value: Snapshot
}

interface Methods {
  restore: () => void,
  remove: () => void,
  showConfirmationDialog: (type: 'restore' | 'delete') => Promise<number>,
  showRestoringSnapshotDialog: () => Promise<void>,
  removeAllListeners: () => void,
}

interface Computed {
  snapshot: Snapshot
}

interface Props {
  value: Snapshot
}

export default Vue.extend<Data, Methods, Computed, Props>({
  name:  'snapshot-card',
  props: {
    value: {
      type:     Object as PropType<Snapshot>,
      required: true,
    },
  },

  computed: {
    snapshot() {
      return {
        ...this.value,
        created: formatDate(this.value.created),
      };
    },
  },

  methods: {
    async restore() {
      const ok = await this.showConfirmationDialog('restore');

      if (ok) {
        ipcRenderer.send('preferences-close');
        ipcRenderer.on('dialog/mounted', async() => {
          const error = await this.$store.dispatch('snapshots/restore', this.snapshot.id);

          if (error) {
            ipcRenderer.send('dialog/error', { dialog: 'SnapshotsDialog', error: this.t('snapshots.dialog.restoring.error', { error }) });
          } else {
            ipcRenderer.send('dialog/close', { dialog: 'SnapshotsDialog' });
            ipcRenderer.send('snapshot', {
              type:     'restore',
              result:   'success',
              snapshot: this.snapshot,
            });
          }
        });

        await this.showRestoringSnapshotDialog();
        this.removeAllListeners();
      }
    },

    async remove() {
      const ok = await this.showConfirmationDialog('delete');

      if (ok) {
        await this.$store.dispatch('snapshots/delete', this.snapshot.id);
        ipcRenderer.send('snapshot', {
          type:     'delete',
          result:   'success',
          snapshot: this.snapshot,
        });
      }
    },

    async showConfirmationDialog(type: 'restore' | 'delete') {
      const confirm = await ipcRenderer.invoke(
        'show-snapshots-dialog',
        {
          window: {
            buttons: [
              this.t(`snapshots.dialog.${ type }.actions.cancel`),
              this.t(`snapshots.dialog.${ type }.actions.ok`),
            ],
            cancelId: 1,
          },
          format: {
            header:          this.t(`snapshots.dialog.${ type }.header`, { snapshot: this.snapshot.name }),
            snapshot:        this.snapshot,
            info:            type === 'restore' ? this.t(`snapshots.dialog.${ type }.info`, { }, true) : null,
            showProgressBar: true,
          },
        },
      );

      return confirm.response;
    },

    async showRestoringSnapshotDialog() {
      await ipcRenderer.invoke(
        'show-snapshots-dialog',
        {
          window: {
            type:    'question',
            buttons: [
              // this.t('snapshots.dialog.restoring.actions.cancel'),
            ],
            cancelId: 1,
          },
          format: {
            header:          this.t('snapshots.dialog.restoring.header', { snapshot: this.snapshot.name }),
            message:         this.t('snapshots.dialog.restoring.message', { snapshot: this.snapshot.name }, true),
            showProgressBar: true,
          },
        },
      );
    },

    removeAllListeners() {
      ipcRenderer.removeAllListeners('dialog/mounted');
    },
  },
});

</script>

<template>
  <div
    v-if="snapshot"
    class="snapshot-card"
  >
    <div class="content">
      <div class="header">
        <h2>
          {{ snapshot.name }}
        </h2>
      </div>
      <div class="body">
        <div class="created">
          <span>{{ t('snapshots.card.body.createdAt') }}: </span>
          <span class="value">{{ snapshot.created }}</span>
        </div>
        <div class="notes">
          <span>{{ t('snapshots.card.body.notes') }}: </span>
          <span class="value">{{ snapshot.notes || 'n/a' }}</span>
        </div>
      </div>
    </div>
    <div class="actions">
      <button
        class="btn btn-xs role-primary restore"
        @click="restore"
      >
        {{ t('snapshots.card.action.restore') }}
      </button>
      <button
        class="btn btn-xs role-secondary remove"
        @click="remove"
      >
        {{ t('snapshots.card.action.remove') }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .snapshot-card {
    display: flex;
    border: 1px solid var(--border);
    box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.1);

    .content {
      min-width: 300px;
      .header {
        h2 {
          max-width: 500px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
    }

    .actions {
      max-width: 200px;
    }

    .content, .actions {
      display: flex;
      flex-direction: column;
      gap: 15px;
      flex-grow: 1;
      padding: 20px;
    }

    .content .body {
      .value {
        color: var(--input-label);
      }
    }

    .notes {
      max-width: 500px;
      word-wrap: break-word;
      overflow: hidden;
      text-overflow: ellipsis;
    }

  }
</style>
