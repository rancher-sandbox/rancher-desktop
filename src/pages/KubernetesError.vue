<template>
  <div>
    <div class="page-body">
      <div class="error-header">
        <img id="logo" src="../../resources/icons/logo-square-red@2x.png" />
        <h2 data-test="k8s-error-header">
          Kubernetes Error
        </h2>
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
        <div v-if="lastLogLines.length" class="error-part">
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
      lastLogLines:           [],
    };
  },
  computed: {
    joinedLastLogLines(): string {
      return this.lastLogLines.join('\n');
    }
  },
  mounted() {
    ipcRenderer.on('kubernetes-errors-details', (event, titlePart, mainMessage, failureDetails) => {
      this.$data.titlePart = titlePart;
      this.$data.mainMessage = mainMessage;
      this.$data.lastCommand = failureDetails.lastCommand;
      this.$data.lastCommandComment = failureDetails.lastCommandComment;
      this.$data.lastLogLines = failureDetails.lastLogLines;
    });
    ipcRenderer.send('kubernetes-errors/ready');
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

  div.error-part {
    margin-top: 0.5rem;
    margin-bottom: 1.5rem;
    h4 {
      margin-top: auto;
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
