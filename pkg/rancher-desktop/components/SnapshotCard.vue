<script lang="ts">
import dayjs from 'dayjs';
import Vue from 'vue';

import { Snapshot } from '@pkg/main/snapshots/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

import type { PropType } from 'vue';

function formatDate(value: string) {
  if (!value) {
    return null;
  }

  const date = dayjs(value);

  return {
    date: date.format('YYYY-MM-DD'),
    time: date.format('HH:mm'),
  };
}

interface Data {
  value: Snapshot
}

interface Methods {
  restore: () => void,
  remove: () => void,
  showConfirmationDialog: (type: 'restore' | 'delete') => Promise<number>,
  showRestoringSnapshotDialog: () => Promise<void>,
}

interface Computed {
  snapshot: Snapshot & { formattedCreateDate: { date: string, time: string } | null }
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
        formattedCreateDate: formatDate(this.value.created),
      };
    },
  },

  methods: {
    async restore() {
      const ok = await this.showConfirmationDialog('restore');

      /** Clear old event on Snapshots page */
      ipcRenderer.send('snapshot', null);

      if (ok) {
        ipcRenderer.send('preferences-close');
        ipcRenderer.on('dialog/mounted', async() => {
          const error = await this.$store.dispatch('snapshots/restore', this.snapshot.name);

          if (error) {
            ipcRenderer.send('dialog/error', { dialog: 'SnapshotsDialog', error });
          } else {
            ipcRenderer.send('dialog/close', { dialog: 'SnapshotsDialog' });
            ipcRenderer.send('snapshot', {
              type:         'restore',
              result:       'success',
              snapshotName: this.snapshot?.name,
            });
          }
        });

        await this.showRestoringSnapshotDialog();
        ipcRenderer.removeAllListeners('dialog/mounted');
      }
    },

    async remove() {
      const ok = await this.showConfirmationDialog('delete');

      /** Clear old event on Snapshots page */
      ipcRenderer.send('snapshot', null);

      if (ok) {
        const error = await this.$store.dispatch('snapshots/delete', this.snapshot.name);

        ipcRenderer.send('snapshot', {
          type:         'delete',
          result:       error ? 'error' : 'success',
          error,
          snapshotName: this.snapshot.name,
        });
      }
    },

    async showConfirmationDialog(type: 'restore' | 'delete') {
      const confirm: { response: number } = await ipcRenderer.invoke(
        'show-snapshots-confirm-dialog',
        {
          window: {
            buttons: [
              this.t(`snapshots.dialog.${ type }.actions.cancel`),
              this.t(`snapshots.dialog.${ type }.actions.ok`),
            ],
            cancelId: 0,
          },
          format: {
            header:          this.t(`snapshots.dialog.${ type }.header`, { snapshot: this.snapshot.name }),
            snapshot:        this.snapshot,
            message:         type === 'restore' ? this.t(`snapshots.dialog.${ type }.info`, { }, true) : '',
            showProgressBar: true,
          },
        },
      );

      return confirm.response;
    },

    async showRestoringSnapshotDialog() {
      await ipcRenderer.invoke(
        'show-snapshots-blocking-dialog',
        {
          window: {
            buttons:  [],
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
        <div class="created">
          <span
            v-if="snapshot.formattedCreateDate"
            class="value"
            v-html="t('snapshots.card.created', { date: snapshot.formattedCreateDate.date, time: snapshot.formattedCreateDate.time }, true)"
          />
        </div>
      </div>
      <div
        v-if="snapshot.description"
        class="description"
      >
        <span class="value">{{ snapshot.description }}</span>
      </div>
    </div>
    <div class="actions">
      <button
        class="btn btn-xs role-secondary remove"
        @click="remove"
      >
        {{ t('snapshots.card.action.remove') }}
      </button>
      <button
        class="btn btn-xs role-primary restore"
        @click="restore"
      >
        {{ t('snapshots.card.action.restore') }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .snapshot-card {
    display: grid;
    grid-template-columns: auto 300px;
    border: 1px solid var(--border);
    box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.1);
    padding: 25px;
    min-height: 130px;

    .content {
      display: flex;
      flex-direction: column;
      gap: 15px;
      flex-grow: 1;
      min-width: 300px;
      .header {
        h2 {
          max-width: 500px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin: 0 0 5px 0;
        }
      }
      .description {
        max-width: 550px;
        word-wrap: break-word;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }

    .actions {
      display: flex;
      .btn {
        width: 145px;
        height: 30px;
        margin-left: 10px;
      }
    }

    .value {
      color: var(--input-label);
    }
  }
</style>
