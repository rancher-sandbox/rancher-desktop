<script lang="ts">
import { defineComponent } from 'vue';

import EmptyState from '@pkg/components/EmptyState.vue';

export default defineComponent({
  name:       'extensions-uninstalled',
  components: { EmptyState },
  props:      {
    extensionId: {
      required: true,
      type:     String,
    },
  },
  computed: {
    emptyStateIcon(): string {
      return this.t('extensions.icon');
    },
    emptyStateHeading(): string {
      return this.t('extensions.view.emptyState.heading');
    },
    emptyStateBody(): string {
      return this.t(
        'extensions.view.emptyState.body',
        { extensionId: `<code>${ this.extensionId }</code>` },
        true,
      );
    },
  },
  methods: {
    browseExtensions() {
      this.$emit('click:browse');
    },
  },
});
</script>

<template>
  <empty-state
    :icon="emptyStateIcon"
    :heading="emptyStateHeading"
  >
    <template #body>
      <span v-html="emptyStateBody"></span>
    </template>
    <template #primary-action>
      <button
        class="btn role-primary"
        @click="browseExtensions"
      >
        {{ t('extensions.installed.emptyState.button.text') }}
      </button>
    </template>
  </empty-state>
</template>
