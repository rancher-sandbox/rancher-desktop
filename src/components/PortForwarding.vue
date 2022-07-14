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
          v-if="row.row.listenPort"
          class="btn btn-sm role-tertiary"
          @click="update(false, row.row)"
        >
          Cancel
        </button>
        <button
          v-else
          class="btn btn-sm role-tertiary"
          @click="update(true, row.row)"
        >
          Forward
        </button>
      </template>
    </SortableTable>
  </div>
</template>

<script lang="ts">
import { ipcRenderer } from 'electron';
import SortableTable from '@/components/SortableTable/index.vue';
import Checkbox from '@/components/form/Checkbox.vue';
import * as K8s from '@/k8s-engine/k8s';
import Vue, { PropType }from 'vue';

export default Vue.extend({
  components: { SortableTable, Checkbox },
  props:      {
    services: {
      type:     Array as PropType<K8s.ServiceEntry[]>,
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
    update(state: boolean, service: K8s.ServiceEntry, desiredPort?: number) {
      service.listenPort = desiredPort;
      ipcRenderer.invoke('service-forward', service, state);
    },
    handleCheckbox(value: boolean) {
      this.$emit('toggledServiceFilter', value);
    }
  },
});
</script>
