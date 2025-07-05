<!--
  - This is a modal dialog displayed before we ask the user for a sudo password
  - to explain why we're asking for it.
  -->

<template>
  <div class="contents">
    <h2>{{ t('sudoPrompt.title') }}</h2>
    <p>{{ t('sudoPrompt.message', { }, true) }}</p>
    <ul class="reasons">
      <li
        v-for="(paths, reason) in explanations"
        :key="reason"
      >
        <details>
          <summary>{{ SUDO_REASON_DESCRIPTION[reason].title }}</summary>
          <p>{{ SUDO_REASON_DESCRIPTION[reason].description.replace(/\s+/g, ' ') }}</p>
          <p>{{ t('sudoPrompt.explanation') }}</p>
          <code>
            <ul>
              <li
                v-for="path in paths"
                :key="path"
                class="monospace"
                v-text="path"
              />
            </ul>
          </code>
        </details>
      </li>
    </ul>
    <p>{{ t('sudoPrompt.messageSecondPart') }}</p>
    <checkbox
      id="suppress"
      v-model:value="suppress"
      label="Always run without administrative access"
    />
    <button
      ref="accept"
      class="role-primary primary-action"
      @click="close"
    >
      {{ t('sudoPrompt.buttonText') }}
    </button>
  </div>
</template>

<script lang="ts">
import { Checkbox } from '@rancher/components';
import { defineComponent } from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

type SudoReason = 'networking' | 'docker-socket';

/**
 * SUDO_REASON_DESCRIPTION contains text on why we want sudo access.
 * @todo Put this in i18n
 */
const SUDO_REASON_DESCRIPTION: Record<SudoReason, {title: string, description: string}> = {
  networking: {
    title:       'Configure networking',
    description: `Provides bridged networking so that it is easier to access your
                  containers.  If this is not allowed, containers will only be accessible via
                  port forwarding.`,
  },
  'docker-socket': {
    title:       'Set up default docker socket',
    description: 'Provides compatibility with tools that use the docker socket without the ability to use docker contexts.',
  },
};

export default defineComponent({
  name:       'sudo-prompt-dialog',
  components: { Checkbox },
  layout:     'dialog',
  data() {
    return {
      explanations: {} as Partial<Record<SudoReason, string[]>>,
      sized:        false,
      suppress:     false,
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
  },
});
</script>

<style lang="scss">
  :root {
    min-width: 30em;
  }
</style>

<style lang="scss" scoped>
  .contents {
    padding: 0.75rem;
    min-width: 32rem;
    max-width: 32rem;
  }

  summary {
    user-select: none;
    cursor: pointer;
  }

  li {
    &, p {
      margin: 0.5em;
    }
  }

  ul.reasons {
    list-style-type: none;
    padding: 0;
    margin: 0;
  }

  li.monospace {
    /* font-family is set in _typography.scss */
    white-space: pre;
  }

  .reasons code {
    display: block;
    overflow: auto;
  }

  code::-webkit-scrollbar-corner {
    background: rgba(0,0,0,0.5);
  }

  #suppress {
    margin: 0.5rem;
  }

  .primary-action {
    align-self: flex-end;
  }
</style>
