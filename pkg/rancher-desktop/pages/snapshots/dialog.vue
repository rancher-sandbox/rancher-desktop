<script lang="ts">
import os from 'os';

import { Banner } from '@rancher/components';
import Vue from 'vue';

import BackendProgress from '@pkg/components/BackendProgress.vue';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  name:       'snapshots-dialog',
  components: { Banner, BackendProgress },
  layout:     'dialog',
  data() {
    return {
      header:            '',
      message:           '',
      snapshot:          null,
      info:              '',
      bodyStyle:         {},
      error:             '',
      errorTitle:        '',
      errorDescription:  '',
      errorButton:       '',
      buttons:           [],
      response:          0,
      cancelId:          0,
      snapshotEventType: '',
      showProgressBar:   false,
      credentials:       {
        user:     '',
        password: '',
        port:     0,
      },
    };
  },

  async beforeMount() {
    this.credentials = await this.$store.dispatch(
      'credentials/fetchCredentials',
    );
  },

  mounted() {
    ipcRenderer.on('dialog/error', (_event, args) => {
      this.error = args.error;
      this.errorTitle = args.errorTitle;
      this.errorDescription = args.errorDescription;
      this.errorButton = args.errorButton;
    });

    ipcRenderer.on('dialog/info', (_event, args) => {
      this.info = this.t(args.infoKey, {}, true);
    });

    ipcRenderer.on('dialog/options', (_event, { window, format }) => {
      this.header = format.header;
      this.message = format.message;
      this.snapshot = format.snapshot;
      this.info = format.info;
      this.snapshotEventType = format.snapshotEventType;
      this.showProgressBar = format.showProgressBar;
      this.bodyStyle = this.calculateBodyStyle(format.type);
      this.buttons = window.buttons || [];
      this.cancelId = window.cancelId;

      ipcRenderer.send('dialog/ready');
    });

    ipcRenderer.on('dialog/close', (_event, args) => {
      if (args.snapshotEventType !== this.snapshotEventType) {
        return;
      }
      ipcRenderer.send(
        'dialog/close',
        {
          response:  this.response,
          eventType: this.snapshotEventType,
        });
    });

    ipcRenderer.send('dialog/mounted');
  },

  beforeDestroy() {
    ipcRenderer.removeAllListeners('dialog/error');
    ipcRenderer.removeAllListeners('dialog/options');
    ipcRenderer.removeAllListeners('dialog/close');
  },

  methods: {
    async close(index: number) {
      if (this.error && this.snapshotEventType === 'restore') {
        this.quit();

        return;
      }

      if (!this.error && this.snapshotEventType !== 'confirm' && index === this.cancelId) {
        await this.cancelSnapshot();
      }

      ipcRenderer.send('dialog/close', { response: index, eventType: this.snapshotEventType });
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
    quit() {
      fetch(
        `http://localhost:${ this.credentials?.port }/v1/shutdown`,
        {
          method:  'PUT',
          headers: new Headers({
            Authorization: `Basic ${ window.btoa(
              `${ this.credentials?.user }:${ this.credentials?.password }`,
            ) }`,
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        },
      );
    },
    async cancelSnapshot() {
      await fetch(
        `http://localhost:${ this.credentials?.port }/v1/snapshots/cancel`,
        {
          method:  'POST',
          headers: new Headers({
            Authorization: `Basic ${ window.btoa(
              `${ this.credentials?.user }:${ this.credentials?.password }`,
            ) }`,
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        },
      );
      ipcRenderer.send('snapshot/cancel');
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
          <h1 v-if="errorTitle">
            {{ errorTitle }}
          </h1>
          <h1
            v-else
            v-clean-html="header"
          />
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
                  v-clean-html="t('snapshots.card.created', { date: snapshot.formattedCreateDate.date, time: snapshot.formattedCreateDate.time }, true)"
                  class="value"
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
        v-if="errorDescription"
        class="message"
      >
        <span
          v-clean-html="errorDescription"
          class="value"
        />
      </div>
      <div
        v-else-if="message"
        class="message"
      >
        <slot name="message">
          <span
            v-clean-html="message"
            class="value"
          />
        </slot>
      </div>
      <div
        v-if="info"
        class="info"
      >
        <slot name="info">
          <Banner
            class="banner mb-20 info-banner"
            color="info"
          >
            <span v-clean-html="info" />
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
            <span v-clean-html="error" />
            <a
              href="#"
              @click.prevent="showLogs"
            >{{ t('snapshots.dialog.showLogs') }}</a>
          </Banner>
        </slot>
      </div>
    </div>
    <backend-progress
      v-if="showProgressBar"
      class="progress"
    />
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
            <template v-if="errorButton">
              {{ errorButton }}
            </template>
            <template v-else>
              {{ t('snapshots.dialog.buttons.error') }}
            </template>
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

    .progress {
      margin: 1.25rem 0;
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

  .info-banner :deep(code) {
    padding: 2px;
  }
</style>
