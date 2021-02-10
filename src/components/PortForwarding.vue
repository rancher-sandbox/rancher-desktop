<!--
  - This is the PortForwarding table in the K8s page.
  -->
<template>
  <div>
    <SortableTable
      :headers="headers"
      :rows="rows"
      key-field="key"
      default-sort-by="namespace"
      :table-actions="false"
      :paging="true"
    >
      <template #row-actions="{row}">
        <button
          v-if="row.listenPort"
          class="btn btn-sm role-tertiary"
          @click="update(false, row)"
        >
          Cancel
        </button>
        <button
          v-else
          class="btn btn-sm role-tertiary"
          @click="update(true, row)"
        >
          Forward
        </button>
      </template>
    </SortableTable>
  </div>
</template>

<script>
import SortableTable from '@/components/SortableTable';
import { ipcRenderer } from 'electron';

export default {
  components: {
    SortableTable,
  },
  props: {
    services: {
      type:     Array,
      required: true,
    },
  },
  data() {
    return {
      headers: [
        {
          name:  'namespace',
          label: 'Namespace',
          sort:  ['namespace', 'name'],
        },
        {
          name:  'name',
          label: 'Name',
          sort:  ['name', 'namespace'],
        },
        {
          name:  'portName',
          label: 'Port',
          sort:  ['portName', 'namespace', 'name'],
        },
        {
          name:  'listenPort',
          label: 'Local Port',
          sort:  ['listenPort', 'namespace', 'name'],
        },
      ],
    };
  },
  computed: {
    rows() {
      return this.services.map(service => ({
        namespace:  service.namespace,
        name:       service.name,
        portName:   service.portName || service.port,
        port:       service.port,
        listenPort: service.listenPort,
        key:        `${service.namespace}/${service.name}:${service.portName}`,
      }));
    },
  },
  methods: {
    update(state, service) {
      ipcRenderer.invoke('service-forward', service, state);
    },
  },
};
</script>
