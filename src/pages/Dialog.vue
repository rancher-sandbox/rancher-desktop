<script lang="ts">
import os from 'os';
import Vue from 'vue';
import { ipcRenderer } from 'electron';

import Checkbox from '@/components/form/Checkbox.vue';

export default Vue.extend({
  name:       'rd-dialog',
  components: { Checkbox },
  layout:     'dialog',
  data() {
    return {
      message:         '',
      detail:          '',
      checkboxLabel:   '',
      buttons:         [],
      response:        0,
      checkboxChecked: false,
      cancelId:        0
    };
  },
  mounted() {
    ipcRenderer.on('dialog/options', (_event, options: any) => {
      this.message = options.message;
      this.detail = options.detail;
      this.checkboxLabel = options.checkboxLabel;
      this.buttons = options.buttons;
      this.cancelId = options.cancelId;
    });

    ipcRenderer.send('dialog/ready');
  },
  methods: {
    close(index: number) {
      ipcRenderer.send('dialog/close', { response: index, checkboxChecked: this.checkboxChecked });
    },
    isDarwin() {
      return os.platform().startsWith('darwin');
    }
  }
});
</script>

<template>
  <div class="dialog-container">
    <div v-if="message" class="message">
      <slot name="message">
        {{ message }}
      </slot>
    </div>
    <div v-if="detail" class="detail">
      <slot name="detail">
        {{ detail }}
      </slot>
    </div>
    <div v-if="checkboxLabel" class="checkbox">
      <slot name="checkbox">
        <checkbox v-model="checkboxChecked" :label="checkboxLabel" />
      </slot>
    </div>
    <div
      class="actions"
      :class="{ 'actions-reverse': isDarwin() }"
    >
      <slot name="actions">
        <template v-if="!buttons.length">
          <button class="btn role-primary">
            OK
          </button>
        </template>
        <template v-else>
          <button
            v-for="(buttonText, index) in buttons"
            :key="index"
            class="btn role-primary"
            :class="index === 0 ? 'role-primary' : 'role-secondary'"
            @click="close(index)"
          >
            {{ buttonText }}
          </button>
        </template>
      </slot>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .dialog-container {
    display: flex;
    width: 32rem;
    max-width: 40rem;
  }

  .message {
    font-size: 1.5rem;
    line-height: 2rem;
    font-weight: 600;
  }

  .checkbox {
    padding-left: 0.25rem;
  }

  .actions {
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    gap: 0.25rem;
    padding-top: 1rem;
  }

  .actions-reverse {
    justify-content: flex-start;
    flex-direction: row-reverse;
  }
</style>
