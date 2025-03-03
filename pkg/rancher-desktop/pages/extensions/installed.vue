<script lang="ts">
import semver from 'semver';
import Vue from 'vue';
import { mapGetters } from 'vuex';

import EmptyState from '@pkg/components/EmptyState.vue';
import LoadingIndicator from '@pkg/components/LoadingIndicator.vue';
import NavIconExtension from '@pkg/components/NavIconExtension.vue';
import SortableTable from '@pkg/components/SortableTable/index.vue';
import type { ExtensionWithId, MarketplaceData } from '@pkg/store/extensions';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default Vue.extend({
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
    ...mapGetters('extensions', { extensionsList: 'list', marketData: 'marketData' }) as {
      extensionsList: () => ExtensionWithId[],
      marketData: () => MarketplaceData[],
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
    async uninstall(installed: ExtensionWithId) {
      this.$set(this.busy, installed.id, true);
      try {
        await this.$store.dispatch('extensions/uninstall', { id: installed.id });
      } finally {
        this.$delete(this.busy, installed.id);
      }
    },
    canUpgrade(installed: ExtensionWithId) {
      const available = this.marketData.find(item => item.slug === installed.id);

      try {
        return available && semver.gt(available.version, installed.version, { loose: true });
      } catch (ex) {
        // If there is invalid semver, don't allow upgrades.
        return false;
      }
    },
    async upgrade(installed: ExtensionWithId) {
      const available = this.marketData.find(item => item.slug === installed.id);

      if (!available) {
        console.error(`Failed to upgrade ${ installed.id }: no version found in catalog`);

        return;
      }

      const id = `${ available.slug }:${ available.version }`;

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
      :rows="extensionsList"
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
              v-if="!busy[row.id] && canUpgrade(row)"
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
