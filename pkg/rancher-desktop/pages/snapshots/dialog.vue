<script lang="ts">
import os from 'os';

import { Banner } from '@rancher/components';
import Vue from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  name:       'snapshots-dialog',
  components: { Banner },
  layout:     'dialog',
  data() {
    return {
      header:          '',
      message:         '',
      snapshot:        null,
      info:            '',
      showProgressBar: false,
      showLogo:        false,
      buttons:         [],
      error:           null,
      response:        0,
      cancelId:        0,
    };
  },

  mounted() {
    ipcRenderer.on('dialog/error', (_event, error) => {
      this.error = error;
    });

    ipcRenderer.on('dialog/options', (_event, { window, format }) => {
      this.header = format.header;
      this.message = format.message;
      this.snapshot = format.snapshot;
      this.info = format.info;
      this.showProgressBar = format.showProgressBar || false;
      this.showLogo = format.showLogo || false;
      this.buttons = window.buttons || [];
      this.cancelId = window.cancelId;
      ipcRenderer.send('dialog/ready');
    });

    ipcRenderer.send('dialog/mounted');
  },

  beforeDestroy() {
    ipcRenderer.removeAllListeners('dialog/error');
    ipcRenderer.removeAllListeners('dialog/options');
  },

  methods: {
    onCLick(index: number) {
      ipcRenderer.send('dialog/action', { response: index });
    },
    isDarwin() {
      return os.platform().startsWith('darwin');
    },
  },
});
</script>

<template>
  <div class="dialog-container">
    <div class="dialog-body">
      <div
        v-if="showLogo"
        alt="Rancher Desktop"
        class="logo"
      >
        <img src="@pkg/assets/images/logo.svg">
      </div>
      <div
        v-if="header"
        class="header"
      >
        <slot name="header">
          <h1>{{ header }}</h1>
        </slot>
      </div>
      <hr class="separator">
      <div
        v-if="message"
        class="message"
      >
        <i class="icon icon-info-circle icon-lg" />
        <slot name="message">
          <span
            class="value"
            v-html="message"
          />
        </slot>
      </div>
      <div
        v-if="snapshot"
        class="snapshot"
      >
        <slot name="snapshot">
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
        </slot>
      </div>

      <div
        v-if="info"
        class="info"
      >
        <slot name="info">
          <Banner
            class="banner mb-20"
            color="info"
          >
            <span v-html="info" />
          </Banner>
        </slot>
      </div>
      <div
        v-if="error"
        class="error"
      >
        <slot name="error">
          <Banner
            class="banner mb-20"
            color="error"
          >
            <span v-html="error" />
          </Banner>
        </slot>
      </div>
    </div>
    <div
      class="dialog-actions"
      :class="{ 'dialog-actions-reverse': isDarwin() }"
    >
      <slot name="actions">
        <template v-if="error">
          <button
            class="btn"
            :class="'role-secondary'"
            @click="onClick(index)"
          >
            {{ t('snapshots.dialog.buttons.error') }}
          </button>
        </template>
        <template v-else>
          <button
            v-for="(buttonText, index) in buttons"
            :key="index"
            class="btn"
            :class="index ? 'role-primary' : 'role-secondary'"
            @click="onCLick(index)"
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
    display: grid;
    grid-auto-flow: row;
    grid-template-rows: 30rem auto;
    width: 45rem;
    padding: 10px;

    .dialog-body {
      margin-top: 0.25rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;

      .logo {
        margin: 0 auto 5px auto;
        width: 215px;
        height: 40px;
      }

      .header {
        H1 {
          margin: 0;
        }
      }

      .separator {
        height: 0;
        border: 0;
        border-top: 1px solid var(--border);
        width: 100%;
      }

      .snapshot {
        .content {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
          padding: 5px;

          .header {
            h2 {
              max-width: 500px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
          }
        }

        .content .body {
          .value {
            color: var(--input-label);
          }
        }
      }

      .message {
        .icon {
          margin-top: 5px;
          margin-right: 4px;grid-auto-flow: column;
        }

        .value {
          color: var(--input-label);
        }

        display: flex;
        font-size: 1.3rem;
        line-height: 2rem;
      }

      .info, .error {
        margin: 0;
        padding: 5px 0 0 0;
      }
    }

    .dialog-actions {
      display: flex;
      flex-direction: row;
      justify-content: flex-end;
      gap: 0.25rem;
    }

    .dialog-actions-reverse {
      justify-content: flex-start;
      flex-direction: row-reverse;
    }
  }
</style>
