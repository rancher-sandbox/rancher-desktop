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
      header:    '',
      message:   '',
      snapshot:  null,
      info:      '',
      bodyStyle: {},
      error:     '',
      buttons:   [],
      response:  0,
      cancelId:  0,
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
      this.bodyStyle = this.calculateBodyStyle(format.type);
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
    close(index: number) {
      ipcRenderer.send('dialog/close', { response: index });
    },
    isDarwin() {
      return os.platform().startsWith('darwin');
    },
    calculateBodyStyle(type: string) {
      return { height: `${ type === 'question' ? 265 : 400 }px` };
    },
    showLogs() {
      ipcRenderer.send('show-logs');
    },
  },
});
</script>

<template>
  <div class="dialog-container">
    <div
      :style="bodyStyle"
      class="dialog-body"
    >
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
        v-if="snapshot"
        class="snapshot"
      >
        <slot name="snapshot">
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
        </slot>
      </div>
      <div
        v-if="message"
        class="message"
      >
        <slot name="message">
          <span
            class="value"
            v-html="message"
          />
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
            <a
              href="#"
              @click.prevent="showLogs"
            >{{ t('snapshots.dialog.showLogs') }}</a>
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
            @click="close(cancelId)"
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
    display: block;
    width: 45rem;
    padding: 10px;

    .dialog-body {
      margin-top: 0.25rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;

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
            max-width: 500px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        }

        .value {
          color: var(--input-label);
        }
      }

      .message {
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
        span {
          max-width: 500px;
          word-wrap: break-word;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-right: 5px;
        }
        A {
          text-decoration: underline;
          color: unset;
        }
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
