<script lang="ts">

import { Banner, LabeledInput, TextAreaAutoGrow } from '@rancher/components';
import dayjs from 'dayjs';
import Vue from 'vue';
import { mapGetters } from 'vuex';

import { Snapshot, SnapshotEvent } from '@pkg/main/snapshots/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

const defaultName = () => {
  const dateString = dayjs().format('YYYY-MM-DD_HH_mm_ss');

  return `Snap_${ dateString }`;
};

interface Data {
  name: string,
  description: string,
  creating: boolean,
}

interface Methods {
  goBack: (event: SnapshotEvent | null) => void;
  submit: () => void;
  showCreatingSnapshotDialog: () => Promise<void>;
}

interface Computed {
  snapshots: Snapshot[];
  valid: boolean;
}

export default Vue.extend<Data, Methods, Computed, never>({
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
    valid() {
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

      ipcRenderer.on('dialog/mounted', async() => {
        const error = await this.$store.dispatch('snapshots/create', { name, description });

        if (error) {
          ipcRenderer.send('dialog/error', { dialog: 'SnapshotsDialog', error });
        } else {
          ipcRenderer.send('dialog/close', { dialog: 'SnapshotsDialog' });

          this.goBack({
            type:         'create',
            result:       'success',
            snapshotName: name,
          });
        }
      });

      await this.showCreatingSnapshotDialog();

      this.creating = false;
      ipcRenderer.removeAllListeners('dialog/mounted');
    },

    async showCreatingSnapshotDialog() {
      await ipcRenderer.invoke(
        'show-snapshots-blocking-dialog',
        {
          window: {
            buttons:  [],
            cancelId: 1,
          },
          format: {
            header:          this.t('snapshots.dialog.creating.header', { snapshot: this.name }),
            showProgressBar: true,
            message:         this.t('snapshots.dialog.creating.message', { snapshot: this.name }, true),
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
          class="input"
          type="text"
          :disabled="creating"
          :maxlength="35"
        />
      </div>
      <div class="field description-field">
        <label>{{ t('snapshots.create.description.label') }}</label>
        <TextAreaAutoGrow
          ref="descriptionInput"
          v-model="description"
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
