<template>
  <div class="container">
    <div class="page-body">
      <div class="error-header">
        <img
          id="logo"
          src="../../../resources/icons/logo-square-red@2x.png"
        />
        <span>
          <h2 data-test="k8s-error-header">
            {{ t('app.name') }} Error
          </h2>
          <h5>{{ versionString }}</h5>
        </span>
      </div>
      <div class="k8s-error">
        <div class="error-part">
          <h4>{{ titlePart }}</h4>
          <pre id="main-message">{{ mainMessage }}</pre>
        </div>
        <div
          v-if="lastCommand"
          class="error-part command"
        >
          <h4>Last command run:</h4>
          <p>{{ lastCommand }}</p>
        </div>
        <div
          v-if="lastCommandComment"
          class="error-part"
        >
          <h4>Context:</h4>
          <p>{{ lastCommandComment }}</p>
        </div>
        <div
          v-if="lastLogLines.length"
          class="error-part grow"
        >
          <h4>
            Some recent <a
              href="#"
              @click.prevent="showLogs"
            >logfile</a> lines:
          </h4>
          <pre id="log-lines">{{ joinedLastLogLines }}</pre>
        </div>
      </div>
    </div>
    <button
      data-test="accept-btn"
      class="role-primary primary-action"
      @click="close"
    >
      Close
    </button>
  </div>
</template>

<script lang="ts">
import os from 'os';

import { defineComponent } from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default defineComponent({
  name:   'kubernetes-error-dialog',
  layout: 'dialog',
  data() {
    return {
      titlePart:          '',
      mainMessage:        '',
      lastCommand:        '',
      lastCommandComment: '',
      lastLogLines:       [],
      appVersion:         '',
    };
  },
  computed: {
    joinedLastLogLines(): string {
      return this.lastLogLines.join('\n');
    },
    platform(): string {
      return os.platform();
    },
    arch(): string {
      const arch = os.arch();

      return arch === 'arm64' ? 'aarch64' : arch;
    },
    versionString(): string {
      return `Rancher Desktop ${ this.appVersion } - ${ this.platform } (${ this.arch })`;
    },
  },
  beforeMount() {
    ipcRenderer.on('get-app-version', (_event, version) => {
      this.appVersion = version;
    });
    ipcRenderer.send('get-app-version');
  },
  mounted() {
    ipcRenderer.on('dialog/populate', (event, titlePart, mainMessage, failureDetails) => {
      this.$data.titlePart = titlePart;
      this.$data.mainMessage = mainMessage;
      this.$data.lastCommand = failureDetails.lastCommand;
      this.$data.lastCommandComment = failureDetails.lastCommandComment;
      this.$data.lastLogLines = failureDetails.lastLogLines;
    });
    // Tell the dialog layout to set flex on the height.
    document.documentElement.setAttribute('data-flex', 'height');
  },
  methods: {
    close() {
      window.close();
    },
    showLogs() {
      ipcRenderer.send('show-logs');
    },
  },
});
</script>

<style lang="scss" scoped>
  .container {
    min-width: 52rem;
  }

  .error-header {
    display: flex;
    gap: 0.75rem;
    h2 {
      margin-top: 0.25rem;
    }
  }

  img#logo {
    height: 32px;
    width: 32px;
  }
  .page-body {
    display: flex;
    flex-grow: 1;
    flex-flow: column;
  }
  .k8s-error {
    display: flex;
    flex-grow: 1;
    flex-flow: column;
  }
  pre#log-lines {
    height: 8rem;
    white-space: pre-wrap;
    text-indent: -4em;
    padding-left: 4em;
    min-width: 80vw; /* 80% of viewport-width as specified in createWindow() in window/index.ts */
  }
  pre#main-message {
    white-space: pre-line;
    min-width: 80vw; /* See comment for pre#log-lines */
  }

  .error-part {
    margin-top: 0.5rem;
    margin-bottom: 1.5rem;
    h4 {
      margin-top: auto;
    }
    &.command p {
      font-family: monospace;
      white-space: pre-wrap;
    }
    &.grow {
      display: flex;
      flex-flow: column;
      flex-grow: 1;
      & > *:not(h4) {
        flex-grow: 1;
      }
    }
  }

  .primary-action {
    align-self: flex-end;
  }
</style>
