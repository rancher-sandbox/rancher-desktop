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
        :button-label="`label for ${ row.imageName }`"
        :dropdown-options="buttonOptions"
        size="sm"
        @click-action="args => doClick(row, args)"
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
      console.log('QQQ: In buttonOptions');
      const chuck = [
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

      console.log(chuck);
      console.table(chuck);

      return chuck;
    },
  },

  methods: {
    doClick(row, args) {
      console.log('QQQ: doClick');
      console.table(row);
      console.table(args);
    },
    doThing1(obj) {
      console.log('doing thing 1');
      console.table(obj);
    },
    doThing2(obj) {
      console.log('doing thing 2');
      console.table(obj);
    },
    doThing3(obj) {
      console.log('doing thing 3');
      console.table(obj);
    },
    doThing4(obj) {
      console.log('doing thing 4');
      console.table(obj);
    },
  }
};
</script>
