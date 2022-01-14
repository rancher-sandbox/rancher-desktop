<template>
  <div>
    <h2 data-test="k8s-error-header">
      Kubernetes Error
    </h2>
    <div class="k8s-error">
      <div class="error-part">
        <h4>{{ titlePart }}</h4>
        <p>{{ mainMessage }}</p>
      </div>
      <div class="error-part">
        <h4>Last command run:</h4>
        <p>{{ lastCommand }}</p>
      </div>
      <div v-if="lastCommandComment" class="error-part">
        <h4>Context:</h4>
        <p>{{ lastCommandComment }}</p>
      </div>
      <div v-if="logLines.length" class="error-part">
        <h4>Some recent logfile lines:</h4>
        <pre id="log-lines">{{ wrappedLines }}</pre>
      </div>
    </div>
    <div class="button-area">
      <button data-test="accept-btn" class="role-primary" @click="close">
        Close
      </button>
    </div>
  </div>
</template>

<script lang="ts">

import { ipcRenderer } from 'electron';
import Vue from 'vue';
import wrap from 'word-wrap';

export default Vue.extend({
  layout: 'dialog',
  data() {
    return {
      titlePart:          '',
      mainMessage:        '',
      lastCommand:        '',
      lastCommandComment: '',
      logLines:           [],
    };
  },
  computed: {
    wrappedLines(): string {
      const leadingWSPtn = /^(\s+)(.+)$/;
      const indent = '    ';
      return this.logLines.map((line) => {
        // word-wrap is a bit brain-dead: either you get no leading indent, or you get it on all lines
        const m = leadingWSPtn.exec(line);
        const [leadingWS, rest] = m ? [m[1], m[2]] : ['', line];
        const fixedLine = wrap(rest, {
          width: 60,
          indent
        });

        return leadingWS + fixedLine.trimStart();
      }).join('\n');
    }
  },
  mounted() {
    ipcRenderer.send('kubernetes-errors/ready');
    ipcRenderer.on('kubernetes-errors-details', (event, titlePart, mainMessage, lastCommand, lastCommandComment, logLines) => {
      this.$data.titlePart = titlePart;
      this.$data.mainMessage = mainMessage;
      this.$data.lastCommand = lastCommand;
      this.$data.lastCommandComment = lastCommandComment;
      this.$data.logLines = logLines;
    });
  },
  methods: {
    close() {
      window.close();
    },
  }
});
</script>

<style lang="scss" scoped>
  pre#log-lines {
    height: 8rem;
    overflow: scroll;
    white-space: pre;
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
  }

  .button-area {
    // sass doesn't understand `end` here, and sets up `[dir]` selectors that
    // will never match anything.  So we need to use `right`, which breaks RTL.
    text-align: right;
  }
</style>
