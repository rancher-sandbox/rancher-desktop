<template>
  <div class="volumes">
    <SortableTable
      class="volumesTable"
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
      <template #col:volumeName="{row}">
        <td>
          <span v-tooltip="getTooltipConfig(row.volumeName)">
            {{ shortSha(row.volumeName) }}
          </span>
        </td>
      </template>
      <template #col:driver="{row}">
        <td>
          {{ row.Driver }}
        </td>
      </template>
      <template #col:mountpoint="{row}">
        <td>
          <span v-tooltip="getTooltipConfig(row.mountpoint)">
            {{ shortPath(row.mountpoint) }}
          </span>
        </td>
      </template>
    </SortableTable>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import {mapGetters} from 'vuex';

import SortableTable from '@pkg/components/SortableTable';
import {ContainerEngine} from '@pkg/config/settings';
import {ipcRenderer} from '@pkg/utils/ipcRenderer';

export default Vue.extend({
  name:       'Volumes',
  title:      'Volumes',
  components: { SortableTable },
  data() {
    return {
      settings: undefined,
      ddClient: null,
      volumesList: null,
      volumesNamespaces: [],
      // Interval to ensure the first fetch succeeds (instead of trying to stream in updates)
      volumeCheckInterval: null,
      headers:      [
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

      return this.volumesList.map((volume) => {
        return {
          ...volume,
          volumeName: volume.Name,
          created: volume.CreatedAt ? new Date(volume.Created).toLocaleDateString() : '',
          mountpoint: volume.Mountpoint || '',
          driver: volume.Driver || '',
          availableActions: [
            {
              label: this.t('volumes.manager.table.action.browse'),
              action: 'browseFiles',
              enabled: true,
              bulkable: false,
            },
            {
              label: this.t('volumes.manager.table.action.delete'),
              action: 'deleteVolume',
              enabled: true,
              bulkable: true,
              bulkAction: 'deleteVolume',
            },
          ],
          deleteVolume: (...args) => {
            this.deleteVolume(...(args?.length > 0 ? args : [volume]));
          },
          browseFiles: () => {
            this.$router.push({name: 'volumes-files-name', params: {name: volume.Name}});
          },
        };
      });
    },
    isNerdCtl() {
      return this.settings?.containerEngine?.name === ContainerEngine.CONTAINERD;
    },
    supportsNamespaces() {
      return this.settings?.containerEngine?.name === ContainerEngine.CONTAINERD;
    },
    selectedNamespace() {
      return this.supportsNamespaces ? this.settings?.containers.namespace : undefined;
    },
  },
  mounted() {
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
      this.volumesList = [];
      this.checkSelectedNamespace();
    });

    this.checkVolumes().catch(console.error);
    this.volumeCheckInterval = setInterval(this.checkVolumes.bind(this), 5_000);
  },
  beforeDestroy() {
    ipcRenderer.removeAllListeners('settings-update');
    clearInterval(this.volumeCheckInterval);
  },
  methods: {
    async checkVolumes() {
      if (window.ddClient && this.isK8sReady && this.settings) {
        this.ddClient = window.ddClient;

        try {
          if (this.supportsNamespaces) {
            await this.getNamespaces();
          }
        } catch (error) {
          console.error('There was a problem fetching namespaces:', {error});
        }
        try {
          await this.getVolumes();
          clearInterval(this.volumeCheckInterval);
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
          {containers: {namespace: defaultNamespace}});
      }
    },
    async onChangeNamespace(value) {
      if (value !== this.selectedNamespace) {
        await ipcRenderer.invoke('settings-write',
          {containers: {namespace: value.target.value}});
        this.getVolumes();
      }
    },
    async getNamespaces() {
      this.volumesNamespaces = await this.ddClient?.docker.listNamespaces();
      this.checkSelectedNamespace();
    },
    async getVolumes() {
      try {
        const options = {};

        if (this.supportsNamespaces && this.selectedNamespace) {
          options.namespace = this.selectedNamespace;
        }

        const volumes = await this.ddClient?.docker.rdListVolumes(options);
        this.volumesList = volumes || [];
      } catch (error) {
        console.error('Failed to fetch volumes:', error);
        this.volumesList = [];
      }
    },
    async deleteVolume(volume) {
      await this.execCommand('volume rm', volume);
    },
    async execCommand(command, _ids) {
      try {
        const ids = Array.isArray(_ids) ? _ids.map(v => v.Name) : [_ids.Name];
        const [baseCommand, ...subCommands] = command.split(' ');

        console.info(`Executing command ${ command } on volume ${ ids }`);

        const execOptions = {cwd: '/'};
        if (this.supportsNamespaces && this.selectedNamespace) {
          execOptions.namespace = this.selectedNamespace;
        }

        const {stderr, stdout} = await this.ddClient.docker.cli.exec(
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
        window.alert(error.message);
        console.error(`Error executing command ${ command }`, error.message);
      }
    },
    shortSha(sha) {
      const prefix = 'sha256:';

      if (sha && sha.startsWith(prefix)) {
        const startIndex = sha.indexOf(prefix) + prefix.length;
        const actualSha = sha.slice(startIndex);

        return `${ sha.slice(0, startIndex) }${ actualSha.slice(0, 3) }..${ actualSha.slice(-3) }`;
      }

      return sha || '';
    },
    shortPath(path) {
      if (!path || path.length <= 40) {
        return path || '';
      }

      return `${path.slice(0, 20)}...${path.slice(-17)}`;
    },
    getTooltipConfig(text) {
      if (!text) {
        return { content: undefined };
      }

      // Show tooltip for sha256 hashes or long paths
      if (text.startsWith('sha256:') || text.length > 40) {
        return {content: text};
      }

      return {content: undefined};
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
