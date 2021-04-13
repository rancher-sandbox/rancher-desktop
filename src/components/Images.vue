<!--
  - This is the Images table in the K8s page.
  -->
<template>
  <SortableTable
    :headers="headers"
    :rows="rows"
    key-field="key"
    default-sort-by="imageName"
    :table-actions="false"
    :paging="true"
  >
    <template #row-actions="{row}">
      <ButtonDropdown
        :button-label="'...'"
        :dropdown-options="buttonOptions"
        size="sm"
        @click-action="(...args) => doClick(row, args)"
      />
      <!--
      <button
        class="btn btn-sm role-tertiary"
        @click="doSomething(row)"
      >
        Do Something
      </button>
      -->
    </template>
  </SortableTable>
</template>

<script>
import ButtonDropdown from '@/components/ButtonDropdown';
import SortableTable from '@/components/SortableTable';
const K8s = require('../k8s-engine/k8s');

export default {
  components: { ButtonDropdown, SortableTable },
  props:      {
    images: {
      type:     Array,
      required: true,
    },
  },

  data() {
    return {
      headers:                   [
        {
          name:  'imageName',
          label: 'IMAGE',
          sort:  ['imageName', 'tag', 'imageID'],
        },
        {
          name:  'tag',
          label: 'TAG',
          sort:  ['tag', 'imageName', 'imageID'],
        },
        {
          name:  'imageID',
          label: 'IMAGE ID',
          sort:  ['imageID', 'imageName', 'tag'],
        },
        {
          name:  'size',
          label: 'SIZE',
          sort:  ['size', 'imageName', 'tag'],
        },
      ],
    };
  },
  computed: {
    rows() {
      return this.images;
    },
    buttonOptions() {
      return [
        {
          label:  `label1`,
          action: this.doThing1,
          value:  1,
        },
        {
          label:  'label2',
          action: this.doThing2,
          value:  2,
        },
        {
          label:  'label3',
          action: this.doThing3,
          value:  3,
        },
        {
          label:  'label4',
          action: this.doThing4,
          value:  4,
        },
      ];
    },
  },

  methods: {
    doClick(row, args) {
      args[0].action(row);
    },
    doThing1(obj) {
      console.log(`doing thing 1 on image ${obj.imageName} (id: ${obj.imageID})`);
    },
    doThing2(obj) {
      console.log(`doing thing 2 on image ${obj.imageName} (id: ${obj.imageID})`);
    },
    doThing3(obj) {
      console.log(`doing thing 3 on image ${obj.imageName} (id: ${obj.imageID})`);
    },
    doThing4(obj) {
      console.log(`doing thing 4 on image ${obj.imageName} (id: ${obj.imageID})`);
    },
  }
};
</script>
