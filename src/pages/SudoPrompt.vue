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
      the following reasons:
    </p>
    <ul class="reasons">
      <li v-for="(paths, reason) in explanations" :key="reason">
        <details>
          <summary>{{ SUDO_REASON_DESCRIPTION[reason].title }}</summary>
          <p>{{ SUDO_REASON_DESCRIPTION[reason].description.replace(/\s+/g, ' ') }}</p>
          <p>This will modify the following paths:</p>
          <ul>
            <li v-for="path in paths" :key="path" class="monospace" v-text="path" />
          </ul>
        </details>
      </li>
    </ul>
    <p>
      We will display the actual prompt once this window is closed.  Cancelling
      the password prompt will cause Rancher Desktop to run with reduced
      functionality.
    </p>
    <checkbox
      id="suppress"
      v-model="suppress"
      label="Always run without administrative access"
    />
    <button ref="accept" class="role-primary primary-action" @click="close">
      OK
    </button>
  </div>
</template>

<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';
import Checkbox from '@/components/form/Checkbox.vue';

type SudoReason = 'networking' | 'docker-socket';

/**
 * SUDO_REASON_DESCRIPTION contains text on why we want sudo access.
 * @todo Put this in i18n
 */
const SUDO_REASON_DESCRIPTION: Record<SudoReason, {title: string, description: string}> = {
  networking: {
    title:       'Configure networking',
    description: `This is used to provide bridged networking so that it is easier to access your
                  containers.  If this is not allowed, containers can only be accessed via port
                  forwarding.`,
  },
  'docker-socket': {
    title:       'Set up default docker socket',
    description: 'This provides compatibility with tools that use the docker socket without the ability to use configuration contexts.'
  }
};

export default Vue.extend({
  components: { Checkbox },
  layout:     'dialog',
  data() {
    return {
      explanations:    {} as Partial<Record<SudoReason, string[]>>,
      sized:        false,
      suppress:        false,
      SUDO_REASON_DESCRIPTION,
    };
  },
  mounted() {
    ipcRenderer.on('dialog/populate', (event, explanations: Partial<Record<SudoReason, string[]>>) => {
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
    },
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

  summary {
    user-select: none;
    cursor: pointer;
  }

  li, p {
    margin: 0.5em;
  }

  ul.reasons {
    list-style-type: none;
    padding-left: 0;
  }

  li.monospace {
    /* font-family is set in _typography.scss */
    white-space: pre;
  }

  #suppress {
    margin: 1em;
  }

  .primary-action {
    align-self: flex-end;
  }
</style>
