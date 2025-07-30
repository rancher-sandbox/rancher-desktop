<template>
  <div class="container">
    <h2>{{ t('unmetPrerequisites.title') }}</h2>
    <p>{{ t('unmetPrerequisites.message') }}</p>
    <ul>
      <li>{{ reason }}</li>
    </ul>
    <p>{{ t('unmetPrerequisites.action') }}</p>
    <div class="button-area">
      <button
        data-test="accept-btn"
        class="role-primary"
        @click="close"
      >
        {{ t('unmetPrerequisites.buttonText') }}
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import type { WSLVersionInfo } from '@pkg/utils/wslVersion';
import type { reqMessageId } from '@pkg/window';

function describeReason(reasonId: Exclude<reqMessageId, 'win32-kernel'>): string;
function describeReason(reasonId: 'win32-kernel', version: WSLVersionInfo): string;
function describeReason(reasonId: reqMessageId, ...extras: any[]): string {
  switch (reasonId) {
  case 'win32-release':
    return 'Requires Windows version 10-1909 or newer';
  case 'win32-kernel': {
    const version: WSLVersionInfo = extras[0];
    const {
      major, minor, build, revision,
    } = version.kernel_version;
    const kernelString = [major, minor, build, revision].join('.');

    return `Requires WSL with kernel 5.15 or newer (have ${ kernelString })`;
  }
  case 'macOS-release':
    return 'Requires macOS version 10.15 or newer';
  case 'linux-nested':
    return 'Nested virtualization not enabled on this host';
  }

  return `Reason ${ reasonId } is unknown`;
}

export default defineComponent({
  name:   'unmet-prerequisites-dialog',
  layout: 'dialog',
  data() {
    return {
      reason:   '',
      suppress: false,
    };
  },
  mounted() {
    ipcRenderer.on('dialog/populate', (event, ...args: Parameters<typeof describeReason>) => {
      this.$data.reason = describeReason(...args);
    });
  },
  methods: {
    close() {
      window.close();
    },
  },
});
</script>

<style lang="scss" scoped>
  .container {
    min-width: 30rem;
  }
  .button-area {
    align-self: flex-end;
  }
</style>
