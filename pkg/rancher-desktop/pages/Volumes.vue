<template>
  <div class="volumes">
    <SortableTable
      ref="sortableTableRef"
      class="volumesTable"
      :headers="headers"
      key-field="Name"
      :rows="rows"
      no-rows-key="volumes.sortableTables.noRows"
      :row-actions="true"
      :paging="true"
      :rows-per-page="10"
      :has-advanced-filtering="true"
      :loading="!volumesList"
    >
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
          <span v-tooltip="getTooltipConfig(row.Mountpoint)">
            {{ shortSha(row.Mountpoint) }}
          </span>
        </td>
      </template>
    </SortableTable>
  </div>
</template>

<script>
import Vue from 'vue';
import { mapGetters } from 'vuex';

import SortableTable from '@pkg/components/SortableTable';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

let volumeCheckInterval = null;

export default Vue.extend({
  name:       'Volumes',
  title:      'Volumes',
  components: { SortableTable },
  data() {
    return {
      settings:     undefined,
      ddClient:     null,
      volumesList:  null,
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

      const volumes = structuredClone(this.volumesList);

      return volumes.map((volume) => {
        volume.volumeName = volume.Name;
        volume.created = volume.CreatedAt || '';

        volume.availableActions = [
          {
            label:      this.t('volumes.manager.table.action.delete'),
            action:     'deleteVolume',
            enabled:    true,
            bulkable:   true,
            bulkAction: 'deleteVolume',
          },
        ];

        if (!volume.deleteVolume) {
          volume.deleteVolume = (...args) => {
            this.deleteVolume(...(args?.length > 0 ? args : [volume]));
          };
        }

        return volume;
      });
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
    });

    this.checkVolumes().catch(console.error);
    volumeCheckInterval = setInterval(this.checkVolumes.bind(this), 5_000);
  },
  beforeDestroy() {
    ipcRenderer.removeAllListeners('settings-update');
    clearInterval(volumeCheckInterval);
  },
  methods: {
    async checkVolumes() {
      if (window.ddClient && this.isK8sReady && this.settings) {
        this.ddClient = window.ddClient;

        try {
          await this.getVolumes();
          clearInterval(volumeCheckInterval);
        } catch (error) {
          console.error('There was a problem fetching volumes:', { error });
        }
      }
    },
    async getVolumes() {
      // Placeholder for volume fetching logic
      // This would typically use something like:
      // const volumes = await this.ddClient?.docker.listVolumes();
      this.volumesList = [];
    },
    async deleteVolume(volume) {
      await this.execCommand('volume rm', volume);
    },
    async execCommand(command, _ids) {
      try {
        const ids = Array.isArray(_ids) ? _ids.map(v => v.Name) : [_ids.Name];

        console.info(`Executing command ${ command } on volume ${ ids }`);

        // SOmething like this needs to happen here
        // const { stderr, stdout } = await this.ddClient.docker.cli.exec(
        //   command,
        //   [...ids],
        //   { cwd: '/' },
        // );

        await this.getVolumes();

        return '';
      } catch (error) {
        window.alert(error.message);
        console.error(`Error executing command ${ command }`, error.message);
      }
    },
    shortSha(sha) {
      const prefix = 'sha256:';

      if (sha && sha.includes(prefix)) {
        const startIndex = sha.indexOf(prefix) + prefix.length;
        const actualSha = sha.slice(startIndex);

        return `${ sha.slice(0, startIndex) }${ actualSha.slice(0, 3) }..${ actualSha.slice(-3) }`;
      }

      return sha || '';
    },
    getTooltipConfig(text) {
      if (!text || !text.includes('sha256:')) {
        return { content: undefined };
      }

      return { content: text };
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

.volumesTable::v-deep .search-box {
  align-self: flex-end;
}
.volumesTable::v-deep .bulk {
  align-self: flex-end;
}
</style>
