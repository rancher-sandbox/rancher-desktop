<script lang="ts">

import { Banner, LabeledInput, TextAreaAutoGrow } from '@rancher/components';
import dayjs from 'dayjs';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import { Snapshot, SnapshotEvent } from '@pkg/main/snapshots/types';
import { currentTime } from '@pkg/utils/dateUtils';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { escapeHtml } from '@pkg/utils/string';

const defaultName = () => {
  const dateString = dayjs().format('YYYY-MM-DD_HH_mm_ss');

  return `Snap_${ dateString }`;
};

export default defineComponent({
  name:       'snapshots-create',
  components: {
    Banner,
    LabeledInput,
    TextAreaAutoGrow,
  },

  data() {
    return {
      name:        defaultName(),
      description: '',
      creating:    false,
    };
  },

  computed: {
    ...mapGetters('snapshots', { snapshots: 'list' }),
    valid(): boolean {
      return !!this.name && !this.snapshots.find((s: Snapshot) => s.name === this.name);
    },
  },

  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: this.t('snapshots.create.title') },
    );
    (this.$refs.nameInput as any)?.select();
  },

  methods: {
    goBack(event: SnapshotEvent | null) {
      this.$router.push({
        name:   'Snapshots',
        params: { ...event },
      });
    },

    async submit() {
      ipcRenderer.send('preferences-close');
      this.creating = true;
      document.getSelection()?.removeAllRanges();

      /** TODO limit description length */
      const { name, description } = this;

      let snapshotCancelled = false;

      ipcRenderer.once('snapshot/cancel', () => {
        snapshotCancelled = true;

        this.goBack({
          type:         'create',
          result:       'cancel',
          snapshotName: name,
          eventTime:    currentTime(),
        });
      });

      ipcRenderer.on('dialog/mounted', async() => {
        const error = await this.$store.dispatch('snapshots/create', { name, description });

        if (error) {
          ipcRenderer.send('dialog/error', { dialog: 'SnapshotsDialog', error });
        } else {
          ipcRenderer.send('dialog/close', { dialog: 'SnapshotsDialog', snapshotEventType: 'create' });

          this.goBack({
            type:         'create',
            result:       snapshotCancelled ? 'cancel' : 'success',
            snapshotName: name,
            eventTime:    currentTime(),
          });
        }
      });

      await this.showCreatingSnapshotDialog();

      this.creating = false;
      ipcRenderer.removeAllListeners('dialog/mounted');
    },

    async showCreatingSnapshotDialog() {
      const name = this.name.length > 32 ? `${ this.name.substring(0, 30) }...` : this.name;

      await ipcRenderer.invoke(
        'show-snapshots-blocking-dialog',
        {
          window: {
            buttons: [
              this.t(`snapshots.dialog.creating.actions.cancel`),
            ],
            cancelId: 0,
          },
          format: {
            header:            this.t('snapshots.dialog.creating.header', { snapshot: name }),
            showProgressBar:   true,
            message:           this.t('snapshots.dialog.creating.message', { snapshot: escapeHtml(name) }, true),
            snapshotEventType: 'create',
          },
        },
      );
    },
  },
});
</script>

<template>
  <div>
    <Banner
      class="banner mb-20"
      color="info"
    >
      {{ t('snapshots.create.info') }}
    </Banner>
    <div class="snapshot-form">
      <div class="field name-field">
        <label>{{ t('snapshots.create.name.label') }}</label>
        <LabeledInput
          ref="nameInput"
          v-model="name"
          v-focus
          data-test="createSnapshotNameInput"
          class="input"
          type="text"
          :disabled="creating"
        />
      </div>
      <div class="field description-field">
        <label>{{ t('snapshots.create.description.label') }}</label>
        <TextAreaAutoGrow
          ref="descriptionInput"
          v-model="description"
          data-test="createSnapshotDescInput"
          class="input"
          :disabled="creating"
        />
      </div>
      <div class="actions">
        <button
          class="btn btn-xs role-primary create"
          :disabled="creating || !valid"
          @click="submit"
        >
          <span>{{ t('snapshots.create.actions.submit') }}</span>
        </button>
        <button
          class="btn btn-xs role-secondary back"
          :disabled="creating"
          @click="goBack(null)"
        >
          <span>{{ t('snapshots.create.actions.back') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .snapshot-form {
    max-width: 500px;
    margin-top: 10px;

    .field {
      margin-bottom: 20px;
    }

    .input {
      margin-top: 5px;
    }

    .description-field .input {
      min-height: 200px;
    }

    .actions {
      display: flex;
      flex-direction: row-reverse;
      gap: 15px;
      flex-grow: 1;

      .btn {
        min-width: 150px;
      }
    }
  }
  .banner {
    margin-top: 10px;
  }
</style>
