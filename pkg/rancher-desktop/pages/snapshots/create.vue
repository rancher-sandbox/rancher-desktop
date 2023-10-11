<script lang="ts">

import { Banner, LabeledInput, TextAreaAutoGrow } from '@rancher/components';
import dayjs from 'dayjs';
import Vue from 'vue';

const defaultName = () => {
  const dateString = dayjs().format('YYYY-MM-DD_HH_mm_ss');

  return `snap_${ dateString }`;
};

interface Data {
  name: string,
  notes: string,
  creating: boolean,
}

interface Methods {
  goBack: () => void;
  submit: () => void;
}

interface Computed {
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
      name:     defaultName(),
      notes:    '',
      creating: false,
    };
  },

  computed: {
    valid() {
      return !!this.name;
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
    goBack() {
      this.$router.push({ name: 'Snapshots' });
    },
    async submit() {
      document.getSelection()?.removeAllRanges();
      this.creating = true;

      /** TODO limit notes length */
      const { name, notes } = this;

      await this.$store.dispatch('snapshots/create', { name, notes });

      this.goBack();
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
      <div class="field notes-field">
        <label>{{ t('snapshots.create.notes.label') }}</label>
        <TextAreaAutoGrow
          ref="notesInput"
          v-model="notes"
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

    .notes-field .input {
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
