<!--
  - This is the PortForwarding table in the K8s page.
  -->
<template>
  <div>
    <div v-if="errorMessage" class="error-div">
      <p>
        {{ errorMessage }}
      </p>
    </div>
    <SortableTable
      :headers="headers"
      :rows="rows"
      key-field="key"
      default-sort-by="namespace"
      :table-actions="false"
      :paging="true"
      :row-actions-width="parseInt(170, 10)"
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
        <div v-if="row.row.listenPort === undefined && !serviceBeingEditedIs(row.row)" class="action-div">
          <button
            class="btn btn-sm role-tertiary"
            @click="emitEditPortForward(row.row)"
          >
            Forward
          </button>
        </div>
        <div v-else-if="serviceBeingEditedIs(row.row)" class="action-div">
          <button
            class="btn btn-sm role-tertiary"
            @click="emitCancelEditPortForward(row.row)"
          >
            🗙
          </button>
          <button
            class="btn btn-sm role-tertiary"
            @click="emitUpdatePortForward()"
          >
            🗸
          </button>
          <input
            type="number"
            :value="portBeingEdited"
            @input="updatePortBeingEdited"
            class="action-input"
          >
        </div>
        <div v-else class="action-div">
          <button
            class="btn btn-sm role-tertiary"
            @click="emitCancelPortForward(row.row)"
          >
            Cancel
          </button>
        </div>
      </template>
    </SortableTable>
  </div>
</template>

<script lang="ts">
import SortableTable from '@/components/SortableTable/index.vue';
import Checkbox from '@/components/form/Checkbox.vue';
import * as K8s from '@/k8s-engine/k8s';
import Vue, { PropType }from 'vue';

type ServiceEntryWithKey = K8s.ServiceEntry & { key: string }

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
    // Used to determine which row to allow editing of listenPort on.
    serviceBeingEdited: {
      type:    Object as PropType<K8s.ServiceEntry>,
      default: null,
    },
    errorMessage: {
      type:    String,
      default: null,
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
      // Internal to this component; contains the port number that
      // the user has entered in, before they have confirmed their entry.
      portBeingEdited: null as number | null,
    };
  },
  computed: {
    isRunning(): boolean {
      return this.k8sState === K8s.State.STARTED;
    },
    rows(): ServiceEntryWithKey[] {
      let services = this.services;

      if (!this.includeKubernetesServices) {
        services = services
          .filter(service => service.namespace !== 'kube-system')
          .filter(service => !(service.namespace === 'default' && service.name === 'kubernetes'));
      }

      return services.map(service => {
        const port = typeof service.port === 'number' ? service.port.toString() : service.port;
        return {
          namespace:  service.namespace,
          name:       service.name,
          portName:   service.portName ?? port,
          port:       service.port,
          listenPort: service.listenPort,
          key:        `${ service.namespace }/${ service.name }:${ service.portName }`,
        }
      });
    },
  },
  methods: {
    serviceBeingEditedIs(service: K8s.ServiceEntry): boolean {
      if (this.serviceBeingEdited === null) {
        return false;
      }

      // compare the two services, minus listenPort property, since this may differ
      return this.serviceBeingEdited.name === service.name &&
        this.serviceBeingEdited.namespace === service.namespace &&
        this.serviceBeingEdited.port === service.port;
    },
    updatePortBeingEdited(event: any): void {
      this.portBeingEdited = parseInt(event.target.value, 10);
    },
    handleCheckbox(value: boolean): void {
      this.$emit('toggledServiceFilter', value);
    },
    emitEditPortForward(service: K8s.ServiceEntry): void {
      this.$emit('editPortForward', service);
    },
    emitCancelPortForward(service: K8s.ServiceEntry): void {
      this.$emit('cancelPortForward', service);
    },
    emitCancelEditPortForward(service: K8s.ServiceEntry): void {
      this.$emit('cancelEditPortForward', service);
    },
    emitUpdatePortForward(service: K8s.ServiceEntry): void {
      if (this.portBeingEdited) {
        const newService = Object.assign({}, service, {listenPort: this.portBeingEdited.valueOf()});
        this.$emit('updatePortForward', newService);
      }
    },
  },
  watch: {
    serviceBeingEdited(newServiceBeingEdited: K8s.ServiceEntry | null): void {
      console.log(`watch serviceBeingEdited newServiceBeingEdited: ${ JSON.stringify(newServiceBeingEdited) }`);
      console.log(`watch serviceBeingEdited this.portBeingEdited before: ${ JSON.stringify(this.portBeingEdited) }`);
      if (newServiceBeingEdited) {
        this.portBeingEdited = newServiceBeingEdited.listenPort ?? null;
      } else {
        this.portBeingEdited = null;
      }
      console.log(`watch serviceBeingEdited this.portBeingEdited after: ${ JSON.stringify(this.portBeingEdited) }`);
    },
  },
});
</script>

<style>
.action-div {
  display: flex;
  flex-direction: row-reverse;
  gap: 0.5rem;
}
.action-input {
  max-height: 30px; /* to match min-height on btn-sm class */
}
.error-div {
  background-color: #c90a00;
  margin: 1rem 0rem;
  padding: 0.5rem;
  width: 100%;
}
</style>
