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
  </SortableTable>
</template>

<script>
import SortableTable from '@/components/SortableTable';
const K8s = require('../k8s-engine/k8s');

export default {
  components: { SortableTable },
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
  },
};
</script>
