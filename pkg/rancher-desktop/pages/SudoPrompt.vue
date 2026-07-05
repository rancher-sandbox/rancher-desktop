<!--
  - This is a modal dialog displayed before we ask the user for a sudo password
  - to explain why we're asking for it.
  -->

<template>
  <div class="contents">
    <h2>{{ t('sudoPrompt.title') }}</h2>
    <p>{{ t('sudoPrompt.message') }}</p>
    <ul class="reasons">
      <li
        v-for="(paths, reason) in explanations"
        :key="reason"
      >
        <details>
          <summary>{{ reasonTitle(reason) }}</summary>
          <p>{{ reasonDescription(reason) }}</p>
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
      :label="t('sudoPrompt.alwaysRunWithout')"
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

/** Maps SudoReason values to translation key segments. */
const REASON_KEY: Record<SudoReason, string> = {
  networking:      'networking',
  'docker-socket': 'dockerSocket',
};

export default defineComponent({
  name:       'sudo-prompt-dialog',
  components: { Checkbox },
  layout:     'dialog',
  data() {
    return {
      explanations: {},
      sized:        false,
      suppress:     false,
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
    reasonTitle(reason: SudoReason): string {
      return this.t(`sudoPrompt.reasons.${ REASON_KEY[reason] }.title`);
    },
    reasonDescription(reason: SudoReason): string {
      return this.t(`sudoPrompt.reasons.${ REASON_KEY[reason] }.description`);
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
