<template>
  <div class="volumes">
    <banner
      v-if="error"
      color="error"
      data-testid="error-banner"
      @close="error = null"
    >
      {{ error }}
    </banner>
    <SortableTable
      class="volumesTable"
      data-testid="volumes-table"
      :headers="headers"
      key-field="Name"
      :rows="rows"
      no-rows-key="volumes.sortableTables.noRows"
      :row-actions="true"
      :paging="true"
      :rows-per-page="10"
      :has-advanced-filtering="false"
      :loading="!volumesList"
    >
      <template #header-middle>
        <div class="header-middle">
          <div v-if="supportsNamespaces">
            <label>Namespace</label>
            <select
              :value="selectedNamespace"
              class="select-namespace"
              data-testid="namespace-selector"
              @change="onChangeNamespace($event)"
            >
              <option
                v-for="item in volumesNamespaces"
                :key="item"
                :selected="item === selectedNamespace"
                :value="item"
              >
                {{ item }}
              </option>
            </select>
          </div>
        </div>
      </template>
      <template #col:volumeName="{ row }">
        <td data-testid="volume-name-cell">
          <span v-tooltip="getTooltipConfig(row.volumeName)">
            {{ shortSha(row.volumeName) }}
          </span>
        </td>
      </template>
      <template #col:driver="{ row }">
        <td data-testid="volume-driver-cell">
          {{ row.Driver }}
        </td>
      </template>
      <template #col:mountpoint="{ row }">
        <td data-testid="volume-mountpoint-cell">
          <span v-tooltip="getTooltipConfig(row.mountpoint)">
            {{ shortPath(row.mountpoint) }}
          </span>
        </td>
      </template>
      <template #col:created="{ row }">
        <td data-testid="volume-created-cell">
          {{ row.created }}
        </td>
      </template>
    </SortableTable>
  </div>
</template>

<script lang="ts">
import { Banner } from '@rancher/components';
import merge from 'lodash/merge';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import SortableTable from '@pkg/components/SortableTable';
import { ContainerEngine } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

const MAX_PATH_LENGTH = 40;

export default defineComponent({
  name:       'Volumes',
  title:      'Volumes',
  components: { SortableTable, Banner },
  data() {
    return {
      settings:                undefined,
      ddClient:                null,
      volumesList:             null,
      volumesNamespaces:       [],
      volumeEventSubscription: null,
      volumePollingInterval:   null,
      error:                   null,
      isComponentMounted:      false,
      headers:                 [
        {
          name:  'volumeName',
          label: this.t('volumes.manage.table.header.volumeName'),
          sort:  ['volumeName'],
        },
        {
          name:  'driver',
          label: this.t('volumes.manage.table.header.driver'),
          sort:  ['driver', 'volumeName'],
        },
        {
          name:  'mountpoint',
          label: this.t('volumes.manage.table.header.mountpoint'),
          sort:  ['mountpoint', 'volumeName'],
        },
        {
          name:  'created',
          label: this.t('volumes.manage.table.header.created'),
          sort:  ['created', 'volumeName'],
          width: 120,
        },
      ],
    };
  },
  computed: {
    ...mapGetters('k8sManager', { isK8sReady: 'isReady' }),
    rows() {
      if (!this.volumesList) {
        return [];
      }

      const volumes = Array.from(this.volumesList.values());

      for (const volume of volumes) {
        merge(volume, {
          volumeName:       volume.Name,
          created:          volume.CreatedAt ? new Date(volume.CreatedAt).toLocaleDateString() : '',
          mountpoint:       volume.Mountpoint || '',
          driver:           volume.Driver || '',
          availableActions: [
            {
              label:    this.t('volumes.manager.table.action.browse'),
              action:   'browseFiles',
              enabled:  true,
              bulkable: false,
            },
            {
              label:      this.t('volumes.manager.table.action.delete'),
              action:     'deleteVolume',
              enabled:    true,
              bulkable:   true,
              bulkAction: 'deleteVolume',
            },
          ],
          deleteVolume: this.createDeleteVolumeHandler(volume),
          browseFiles:  this.createBrowseFilesHandler(volume),
        });
      }

      return volumes;
    },
    isContainerdEngine() {
      return this.settings?.containerEngine?.name === ContainerEngine.CONTAINERD;
    },
    isNerdCtl() {
      return this.isContainerdEngine;
    },
    supportsNamespaces() {
      return this.isContainerdEngine;
    },
    selectedNamespace() {
      return this.supportsNamespaces ? this.settings?.containers.namespace : undefined;
    },
  },
  mounted() {
    this.isComponentMounted = true;
    this.ddClient = window.ddClient;

    this.$store.dispatch('page/setHeader', {
      title:       this.t('volumes.title'),
      description: '',
    });

    ipcRenderer.on('settings-read', (event, settings) => {
      this.settings = settings;
      this.checkVolumes().catch(console.error);
    });

    ipcRenderer.send('settings-read');

    ipcRenderer.on('settings-update', (_event, settings) => {
      this.settings = settings;
      this.volumesList = null;
      this.checkSelectedNamespace();
    });

    this.checkVolumes().catch(console.error);
    this.setupEventSubscriptions();
    this.getVolumes().catch(console.error);
  },
  beforeUnmount() {
    this.isComponentMounted = false;
    this.cleanupEventSubscriptions();
    ipcRenderer.removeAllListeners('settings-update');
  },
  methods: {
    setupEventSubscriptions() {
      if (!window.ddClient || !this.isK8sReady || !this.settings) {
        setTimeout(() => this.setupEventSubscriptions(), 1000);
        return;
      }

      if (this.isNerdCtl) {
        this.setupContainerdVolumePolling();
        return;
      }

      this.volumeEventSubscription = this.ddClient.docker.rdSubscribeToEvents(
        (event) => {
          console.debug('Volume event received:', event);
          this.getVolumes().catch(console.error);
        },
        {
          filters: {
            type:  ['volume'],
            event: ['create', 'destroy', 'mount', 'unmount'],
          },
          namespace: this.selectedNamespace,
        },
      );

      // Fetch initial volume list after setting up event subscription
      this.getVolumes().catch(console.error);
    },

    setupContainerdVolumePolling() {
      // Fetch initial volume list immediately
      this.getVolumes().catch(console.error);

      // Then poll for changes
      this.volumePollingInterval = setInterval(() => {
        if (!this.isComponentMounted) {
          clearInterval(this.volumePollingInterval);
          this.volumePollingInterval = null;
          return;
        }

        this.getVolumes().catch(console.error);
      }, 2000);
    },

    cleanupEventSubscriptions() {
      if (this.volumeEventSubscription) {
        this.volumeEventSubscription.unsubscribe();
        this.volumeEventSubscription = null;
      }

      if (this.volumePollingInterval) {
        clearInterval(this.volumePollingInterval);
        this.volumePollingInterval = null;
      }
    },

    async checkVolumes() {
      if (window.ddClient && this.isK8sReady && this.settings) {
        this.ddClient = window.ddClient;

        try {
          if (this.supportsNamespaces) {
            await this.getNamespaces();
          }
        } catch (error) {
          console.error('There was a problem fetching namespaces:', { error });
        }
        try {
          await this.getVolumes();
        } catch (error) {
          console.error('There was a problem fetching volumes:', { error });
        }
      }
    },
    checkSelectedNamespace() {
      if (!this.supportsNamespaces || this.volumesNamespaces.length === 0) {
        return;
      }
      if (!this.volumesNamespaces.includes(this.selectedNamespace)) {
        const K8S_NAMESPACE = 'k8s.io';
        const defaultNamespace = this.volumesNamespaces.includes(K8S_NAMESPACE) ? K8S_NAMESPACE : this.volumesNamespaces[0];

        ipcRenderer.invoke('settings-write',
          { containers: { namespace: defaultNamespace } });
      }
    },
    async onChangeNamespace(value) {
      if (value !== this.selectedNamespace) {
        await ipcRenderer.invoke('settings-write',
          { containers: { namespace: value.target.value } });
        this.cleanupEventSubscriptions();
        this.setupEventSubscriptions();
        this.getVolumes();
      }
    },
    async getNamespaces() {
      this.volumesNamespaces = await this.ddClient?.docker.listNamespaces();
      this.checkSelectedNamespace();
    },
    updateVolumesList(newVolumes) {
      if (!newVolumes) {
        this.volumesList = null;
        return;
      }

      const newMap = new Map();

      newVolumes.forEach((newVolume) => {
        const existing = this.volumesList?.get(newVolume.Name);
        if (existing) {
          Object.assign(existing, newVolume);
          newMap.set(newVolume.Name, existing);
        } else {
          newMap.set(newVolume.Name, newVolume);
        }
      });

      this.volumesList = newMap;
    },

    async getVolumes() {
      try {
        const options = {};

        if (this.supportsNamespaces && this.selectedNamespace) {
          options.namespace = this.selectedNamespace;
        }

        const volumes = await this.ddClient?.docker.rdListVolumes(options);
        if (volumes) {
          this.updateVolumesList(volumes);
        } else {
          this.volumesList = null;
        }
      } catch (error) {
        console.error('Failed to fetch volumes:', error);
        this.volumesList = null;
      }
    },
    async deleteVolume(volume) {
      await this.execCommand('volume rm', volume);
    },
    async execCommand(command, volumes) {
      try {
        const ids = Array.isArray(volumes) ? volumes.map(v => v.Name) : [volumes.Name];
        const [baseCommand, ...subCommands] = command.split(' ');

        console.info(`Executing command ${ command } on volume ${ ids }`);

        const execOptions = { cwd: '/' };
        if (this.supportsNamespaces && this.selectedNamespace) {
          execOptions.namespace = this.selectedNamespace;
        }

        const { stderr, stdout } = await this.ddClient.docker.cli.exec(
          baseCommand,
          [...subCommands, ...ids],
          execOptions,
        );

        if (stderr) {
          throw new Error(stderr);
        }

        await this.getVolumes();

        return stdout;
      } catch (error) {
        const errorSources = [
          error?.message,
          error?.stderr,
          error?.error,
          typeof error === 'string' ? error : null,
          `Failed to execute command: ${ command }`,
        ];

        this.error = errorSources.find(msg => msg);
        console.error(`Error executing command ${ command }`, error);
      }
    },
    createDeleteVolumeHandler(volume) {
      return (...args) => {
        this.deleteVolume(...(args?.length > 0 ? args : [volume]));
      };
    },
    createBrowseFilesHandler(volume) {
      return () => {
        this.$router.push({ name: 'volumes-files-name', params: { name: volume.Name } });
      };
    },
    shortSha(sha) {
      if (!sha?.startsWith('sha256:')) return sha || '';

      const hash = sha.replace('sha256:', '');
      return `sha256:${ hash.slice(0, 3) }..${ hash.slice(-3) }`;
    },
    shortPath(path) {
      if (!path || path.length <= MAX_PATH_LENGTH) {
        return path || '';
      }

      return `${ path.slice(0, 20) }...${ path.slice(-17) }`;
    },
    getTooltipConfig(text) {
      if (!text) {
        return { content: undefined };
      }

      // Show tooltip for sha256 hashes or long paths
      if (text.startsWith('sha256:') || text.length > MAX_PATH_LENGTH) {
        return { content: text };
      }

      return { content: undefined };
    },
  },
});
</script>

<style lang="scss" scoped>
.volumes {
  &-status {
    padding: 8px 5px;
  }
}

.select-namespace {
  max-width: 24rem;
  min-width: 8rem;
}

.volumesTable::v-deep .search-box {
  align-self: flex-end;
}
.volumesTable::v-deep .bulk {
  align-self: flex-end;
}
</style>
