<!--
  - This is a modal dialog displayed before we ask the user for a sudo password
  - to explain why we're asking for it.
  -->

<template>
  <div class="contents">
    <h2>Administrative Access Required</h2>
    <p>
      Rancher Desktop requires administrative credentials ("sudo access") in
      order to provide a better experience.  We would like to have access for
      the following:
    </p>
    <ul>
      <li v-for="item in explanations" :key="item" class="monospace" v-text="item" />
    </ul>
    <p>
      We will display the actual prompt once this window is closed.  Cancelling
      the password prompt will cause Rancher Desktop to run in reduced
      functionality mode, but it should still start.
    </p>
    <checkbox
      id="suppress"
      v-model="suppress"
      label="Always run without administrative access"
    />
    <button ref="accept" class="role-primary" @click="close">
      OK
    </button>
  </div>
</template>

<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';
import Checkbox from '@/components/form/Checkbox.vue';

export default Vue.extend({
  components: { Checkbox },
  layout:     'dialog',
  data() {
    return {
      explanations:    [] as string[],
      suppress:        false,
      preferredWidth:  0,
      preferredHeight: 0,
    };
  },
  mounted() {
    // We expect some help from the main process to set up the window:
    // Main Process                Window
    // (load window)          -->                        Creating the window.
    //                        <--  "sudo-prompt/load"    The code is loaded.
    // "sudo-prompt/details"  -->                        Provide explanations.
    // "sudo-prompt/size"     -->                        Obtaining the window size.
    //                        <--  "sudo-prompt/ready"   The window is rendered.
    //                        <--  "sudo-prompt/closed"  The window is closed.

    ipcRenderer.on('sudo-prompt/details', async(event, explanations) => {
      this.$data.explanations = explanations;
      await this.$nextTick();
      this.preferredWidth = Math.max(this.preferredWidth, document.documentElement.scrollWidth);
      this.preferredHeight = Math.max(this.preferredHeight, document.documentElement.scrollHeight);
      window.resizeTo(this.preferredWidth, this.preferredHeight);
      ipcRenderer.send('sudo-prompt/ready');
    });
    ipcRenderer.on('sudo-prompt/size', (event, { width, height }) => {
      this.preferredWidth = Math.max(this.preferredWidth, width);
      this.preferredHeight = Math.max(this.preferredHeight, height);
      window.resizeTo(this.preferredWidth, this.preferredHeight);
    });
    window.addEventListener('close', () => {
      ipcRenderer.send('sudo-prompt/closed', this.suppress);
    });
    (this.$refs.accept as HTMLButtonElement)?.focus();
    ipcRenderer.send('sudo-prompt/load');
  },
  methods: {
    close() {
      // Manually send the result, because we won't get an event here.
      ipcRenderer.send('sudo-prompt/closed', this.suppress);
      window.close();
    }
  }
});
</script>

<style lang="scss">
  :root {
    min-width: 30em;
  }
</style>

<style lang="scss" scoped>
  .contents {
    padding: 2em;
  }
  li.monospace {
    /* font-family is set in _typography.scss */
    white-space: pre;
  }
  #suppress {
    margin: 1em;
  }
</style>
