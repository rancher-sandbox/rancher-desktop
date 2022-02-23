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
      <template #header-middle>
        <Checkbox
          :label="'Include Kubernetes services'"
          :value="includeKubernetesServices"
          :disabled="!isRunning || kubernetesIsDisabled"
          @input="handleCheckbox"
        />
      </template>
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
import { ipcRenderer } from 'electron';
import $ from 'jquery';
import SortableTable from '@/components/SortableTable';
import Checkbox from '@/components/form/Checkbox';
const K8s = require('../k8s-engine/k8s');

export default {
  components: { SortableTable, Checkbox },
  props:      {
    services: {
      type:     Array,
      required: true,
    },
    includeKubernetesServices: {
      type:    Boolean,
      default: false,
    },
    k8sState: {
      type:    Number,
      default: K8s.State.STOPPED,
    },
    kubernetesIsDisabled: {
      type:    Boolean,
      default: false,
    },
  },

  data() {
    return {
      headers:                   [
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
    isRunning() {
      return this.k8sState === K8s.State.STARTED;
    },
    rows() {
      let services = this.services;

      if (!this.includeKubernetesServices) {
        services = services
          .filter(service => service.namespace !== 'kube-system')
          .filter(service => !(service.namespace === 'default' && service.name === 'kubernetes'));
      }

      return services.map(service => ({
        namespace:  service.namespace,
        name:       service.name,
        portName:   service.portName || service.port,
        port:       service.port,
        listenPort: service.listenPort,
        key:        `${ service.namespace }/${ service.name }:${ service.portName }`,
      }));
    },
  },
  methods: {
    update(state, service) {
      ipcRenderer.invoke('service-forward', service, state);
    },
    handleCheckbox(value) {
      this.$emit('toggledServiceFilter', value);
    }
  },
};
</script>
