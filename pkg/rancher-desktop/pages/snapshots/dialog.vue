<script lang="ts">
import os from 'os';

import Vue from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  name:   'snapshots-dialog',
  layout: 'dialog',
  data() {
    return {
      name:            '',
      header:          '',
      message:         '',
      detail:          '',
      buttons:         [],
      infoBanner:      '',
      showProgressBar: false,
      showLogo:        false,
      response:        0,
      cancelId:        0,
    };
  },

  mounted() {
    ipcRenderer.on('dialog/options', (_event, { window, format }: any) => {
      this.name = format.name;
      this.header = format.header;
      this.message = window.message;
      this.detail = window.detail;
      this.buttons = window.buttons;
      this.infoBanner = format.infoBanner;
      this.showProgressBar = format.showProgressBar;
      this.showLogo = format.showLogo;
      this.cancelId = window.cancelId;
      ipcRenderer.send('dialog/ready');
    });

    ipcRenderer.send('dialog/mounted');
  },

  methods: {
    close(index: number) {
      ipcRenderer.send('dialog/close', { response: index });
    },
    isDarwin() {
      return os.platform().startsWith('darwin');
    },
  },
});
</script>

<template>
  <div class="dialog-container">
    <div
      v-if="header"
      class="header"
    >
      <slot name="header">
        {{ header }}
      </slot>
    </div>
    <div
      v-if="message"
      class="message"
    >
      <slot name="message">
        {{ message }}
      </slot>
    </div>
    <div
      v-if="detail"
      class="detail"
    >
      <slot name="detail">
        <span
          class="detail-span"
          v-html="detail"
        />
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
            class="btn"
            :class="index ? 'role-primary' : 'role-secondary'"
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
    width: 45rem;
    max-width: 45rem;
  }

  .message {
    font-size: 1.5rem;
    line-height: 2rem;
    font-weight: 600;
  }

  .detail {
    font-size: 1rem;
    line-height: 1.5rem;
  }

  .detail-span {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .actions {
    margin-top: 30rem;
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
