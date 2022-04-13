<template>
  <div>
    <div class="page-body">
      <div class="error-header">
        <img id="logo" src="../../resources/icons/logo-square-red@2x.png" />
        <span>
          <h2 data-test="k8s-error-header">
            Kubernetes Error
          </h2>
          <h5>Rancher Desktop {{ appVersion }} - {{ platform }}</h5>
        </span>
      </div>
      <div class="k8s-error">
        <div class="error-part">
          <h4>{{ titlePart }}</h4>
          <pre id="main-message">{{ mainMessage }}</pre>
        </div>
        <div v-if="lastCommand" class="error-part">
          <h4>Last command run:</h4>
          <p>{{ lastCommand }}</p>
        </div>
        <div v-if="lastCommandComment" class="error-part">
          <h4>Context:</h4>
          <p>{{ lastCommandComment }}</p>
        </div>
        <div v-if="lastLogLines.length" class="error-part grow">
          <h4>Some recent logfile lines:</h4>
          <pre id="log-lines">{{ joinedLastLogLines }}</pre>
        </div>
      </div>
    </div>
    <footer class="page-footer">
      <div class="button-area">
        <button data-test="accept-btn" class="role-primary" @click="close">
          Close
        </button>
      </div>
    </footer>
  </div>
</template>

<script lang="ts">
import os from 'os';
import { ipcRenderer } from 'electron';
import Vue from 'vue';

export default Vue.extend({
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
    }
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
  }
});
</script>

<style lang="scss" scoped>
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
    &.grow {
      display: flex;
      flex-flow: column;
      flex-grow: 1;
      & > *:not(h4) {
        flex-grow: 1;
      }
    }
  }

  .button-area {
    max-height: 4rem;
    float: left;
    margin-left: 1rem;
  }

  .page-footer {
    min-height: 60px;
  }
</style>
