<script lang="ts">
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import EmptyState from '@pkg/components/EmptyState.vue';
import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import NavIconExtension from '@pkg/components/NavIconExtension.vue';
import SortableTable from '@pkg/components/SortableTable/index.vue';
import type { ExtensionState } from '@pkg/store/extensions';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default defineComponent({
  name:       'extensions-installed',
  components: {
    LoadingIndicator, NavIconExtension, SortableTable, EmptyState,
  },
  data() {
    return {
      headers: [
        {
          name:  'icon',
          label: ' ',
          width: 35,
        },
        {
          name:  'id',
          label: 'Name',
        },
        {
          name:  'actions',
          label: ' ',
          width: 76,
        },
      ],
      loading: true,
      busy:    {} as Record<string, boolean>,
    };
  },
  computed: {
    emptyStateIcon(): string {
      return this.t('extensions.installed.emptyState.icon');
    },
    emptyStateHeading(): string {
      return this.t('extensions.installed.emptyState.heading');
    },
    emptyStateBody(): string {
      return this.t('extensions.installed.emptyState.body', { }, true);
    },
    ...mapGetters('extensions', ['installedExtensions']) as {
      installedExtensions: () => ExtensionState[],
    },
  },
  async beforeMount() {
    ipcRenderer.on('extensions/changed', () => {
      this.$store.dispatch('extensions/fetch');
    });
    await this.$store.dispatch('extensions/fetch');
    this.loading = false;
  },
  methods: {
    browseExtensions() {
      this.$emit('click:browse');
    },
    extensionTitle(ext: {id: string, labels: Record<string, string>}): string {
      return ext.labels?.['org.opencontainers.image.title'] ?? ext.id;
    },
    async uninstall(installed: ExtensionState) {
      this.$set(this.busy, installed.id, true);
      try {
        await this.$store.dispatch('extensions/uninstall', { id: installed.id });
      } finally {
        this.$delete(this.busy, installed.id);
      }
    },
    async upgrade(installed: ExtensionState) {
      const id = `${ installed.id }:${ installed.availableVersion }`;

      if (!installed.availableVersion) {
        // Should not have reached here.
        return;
      }
      this.$set(this.busy, installed.id, true);
      try {
        await this.$store.dispatch('extensions/install', { id });
      } finally {
        this.$delete(this.busy, installed.id);
      }
    },
  },
});
</script>

<template>
  <div>
    <sortable-table
      key-field="description"
      :loading="loading"
      :headers="headers"
      :rows="installedExtensions"
      :search="false"
      :table-actions="false"
      :row-actions="false"
    >
      <template #no-rows>
        <td :colspan="headers.length + 1">
          <empty-state
            :icon="emptyStateIcon"
            :heading="emptyStateHeading"
            :body="emptyStateBody"
          >
            <template #primary-action>
              <button
                class="btn role-primary"
                @click="browseExtensions"
              >
                {{ t('extensions.installed.emptyState.button.text') }}
              </button>
            </template>
          </empty-state>
        </td>
      </template>
      <template #col:icon="{row}">
        <td>
          <nav-icon-extension :extension-id="row.id" />
        </td>
      </template>
      <template #col:id="{row}">
        <td>
          {{ extensionTitle(row) }}
        </td>
      </template>
      <template #col:actions="{row}">
        <td>
          <div class="actions">
            <span
              v-if="busy[row.id]"
              name="busy"
              :is-loading="busy"
            >
              <loading-indicator></loading-indicator>
            </span>
            <button
              v-if="!busy[row.id] && row.canUpgrade"
              class="btn btn-sm role-primary"
              @click="upgrade(row)"
            >
              {{ t('extensions.installed.list.upgrade') }}
            </button>
            <button
              :disabled="busy[row.id]"
              class="btn btn-sm role-danger"
              @click="uninstall(row)"
            >
              {{ t('extensions.installed.list.uninstall') }}
            </button>
          </div>
        </td>
      </template>
    </sortable-table>
  </div>
</template>

<style lang="scss" scoped>
.actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: end;
  & > * {
    margin-left: 10px;
  }
}
</style>
