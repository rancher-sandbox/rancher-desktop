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
    };
  },
  mounted() {
    ipcRenderer.on('dialog/populate', (event, explanations) => {
      this.explanations = explanations;
    });
    window.addEventListener('close', () => {
      ipcRenderer.send('sudo-prompt/closed', this.suppress);
    });
    (this.$refs.accept as HTMLButtonElement)?.focus();
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
