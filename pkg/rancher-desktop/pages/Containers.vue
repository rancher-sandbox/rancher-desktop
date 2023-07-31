<template>
  <div class="containers">
    <SortableTable
      ref="containersTable"
      :headers="headers"
      key-field="Id"
      :rows="rows"
      :row-actions="false"
      :table-actions="false"
      :paging="true"
      :loading="!containersList"
    >
      <template #col:ports="{row}">
        <div class="port-container">
          <a
            v-for="port in getUniquePorts(row.Ports)"
            :key="port"
            target="_blank"
            class="link"
            @click="openUrl(port)"
          >
            {{ port }}
          </a>
        </div>
      </template>
    </SortableTable>
  </div>
</template>

<script>
import SortableTable from '@pkg/components/SortableTable';
import { shell } from 'electron';
import { cloneDeep } from 'lodash';

import { defaultSettings } from '@pkg/config/settings';
let hasContainers = false;

export default {
  name:       'Containers',
  title:      'Containers',
  components: { SortableTable },
  data() {
    return {
      settings:       defaultSettings,
      containersList: null,
      mountTable:     false,
      headers:
      [
        // INFO: Disable for now since we can only get the running containers.
        // {
        //   name:  'containerState',
        //   label: this.t('containers.manage.table.header.state'),
        //   sort:  ['containerName', 'image', 'imageName'],
        // },
        {
          name:  'containerName',
          label: this.t('containers.manage.table.header.containerName'),
          sort:  ['containerName', 'image', 'imageName'],
        },
        {
          name:  'imageName',
          label: this.t('containers.manage.table.header.image'),
          sort:  ['imageName', 'containerName', 'imageName'],
        },
        {
          name:  'ports',
          label: this.t('containers.manage.table.header.ports'),
          sort:  ['ports', 'containerName', 'imageName'],
        },
        {
          name:  'started',
          label: this.t('containers.manage.table.header.started'),
          sort:  ['si', 'containerName', 'imageName'],
          width: 120,
        },
      ],
    };
  },
  computed: {
    rows() {
      if (!this.containersList) {
        return [];
      }

      const containers = cloneDeep(this.containersList);

      return containers
        .map((container) => {
          container.state = container.State;
          container.containerName = container.Names[0].replace(/_[a-z0-9-]{36}_[0-9]+/, '');
          container.started = container.Status;
          container.imageName = container.Image;

          container.availableActions = [
            {
              label:   'Stop',
              action:  'stopContainer',
              enabled: true,
              icon:    'icon icon-pause',
            }, {
              label:      this.t('images.manager.table.action.delete'),
              action:     'deleteContainers',
              enabled:    true,
              icon:       'icon icon-delete',
              bulkable:   true,
              bulkAction: 'deleteContainers',
            },
          ];

          if (!container.stopContainer) {
            container.stopContainer = this.stopContainer.bind(this, container);
          }

          if (!container.deleteContainers) {
            container.deleteContainers = this.deleteContainers.bind(this, container);
          }

          return container;
        });
    },
  },

  mounted() {
    this.$store.dispatch('page/setHeader', {
      title:       this.t('containers.title'),
      description: '',
    });

    // INFO: We need to set hasContainers outside of the component in the global scope so it won't re-render when we get the list.
    const intervalId = setInterval(() => {
      if (hasContainers) {
        return;
      }

      if (window.ddClient) {
        window.ddClient?.docker.listContainers().then((containers) => {
          console.log(' containers;', containers);
          // INFO: This will only get the currently running containers.
          this.containersList = containers;
          hasContainers = true;
          this.mountTable = true;
        });

        clearInterval(intervalId);
      }
    }, 1000);
  },
  beforeDestroy() {
    clearInterval(this.intervalId);
    hasContainers = false;
  },
  methods: {
    stopContainer() {
      console.info('To implement');
    },
    deleteContainers() {
      console.info('To implement');
    },
    getUniquePorts(obj) {
      const uniquePorts = {};

      Object.keys(obj).forEach((key) => {
        const ports = obj[key];
        const firstPort = ports[0].HostPort;
        const secondPort = ports[1].HostPort;

        uniquePorts[`${ firstPort }:${ secondPort }`] = true;
      });

      return Object.keys(uniquePorts);
    },
    openUrl(port) {
      const hostPort = parseInt(port.split(':')[0]);

      if ([80, 443].includes(hostPort)) {
        hostPort === 80 ? shell.openExternal(`http://localhost`) : shell.openExternal(`https://localhost`);
      } else {
        return shell.openExternal(`http://localhost:${ hostPort }`);
      }
    },
  },
};
</script>

<style lang="scss" scoped>
  .link {
    cursor: pointer;
    text-decoration: none;
  }

  .state-container {
    padding: 8px 5px;
    margin-top: 5px;
  }

  .port-container{
    display: grid;
    grid-auto-rows: 1fr;
    grid-gap: 5px;
    margin: 5px 0;
  }
</style>
