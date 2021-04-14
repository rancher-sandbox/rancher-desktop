<!--
  - This is the Images table in the K8s page.
  -->
<template>
  <div>
    <Checkbox
      :label="'Show all images'"
      :value="showAll"
      @input="handleCheckbox"
    />
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
          :dropdown-options="buttonOptions(row)"
          size="sm"
          @click-action="(rowOption) => doClick(row, rowOption)"
        />
      </template>
    </SortableTable>

    <hr>
    Name of image to pull:
    <input
      v-model="imageToPull"
      type="text"
      maxlength="50"
      placeholder="docker image"
      class="input-sm inline">
    <button
      class="btn btn-sm role-tertiary"
      :disabled="imageToPullButtonDisabled"
      @click="doPullAnImage"
    >Pull an Image...
    </button>
    <hr>
    Name of image to build:
    <input
      v-model="imageToBuild"
      type="text"
      maxlength="50"
      placeholder="image name with tag"
      class="input-sm inline">
    <button
      class="btn btn-sm role-tertiary"
      @click="doBuildAnImage"
    >Build an Image...
    </button>
  </div>

</template>

<script>
import ButtonDropdown from '@/components/ButtonDropdown';
import SortableTable from '@/components/SortableTable';
import Checkbox from '@/components/form/Checkbox';

const {ipcRenderer} = require('electron');
const K8s = require('../k8s-engine/k8s');

export default {
  components: {ButtonDropdown, Checkbox, SortableTable},
  props: {
    images: {
      type: Array,
      required: true,
    },
    showAll: {
      type:    Boolean,
      default: false,
    },
  },

  data() {
    return {
      headers: [
        {
          name: 'imageName',
          label: 'IMAGE',
          sort: ['imageName', 'tag', 'imageID'],
        },
        {
          name: 'tag',
          label: 'TAG',
          sort: ['tag', 'imageName', 'imageID'],
        },
        {
          name: 'imageID',
          label: 'IMAGE ID',
          sort: ['imageID', 'imageName', 'tag'],
        },
        {
          name: 'size',
          label: 'SIZE',
          sort: ['size', 'imageName', 'tag'],
        },
      ],
      imageToBuild: '',
      imageToPull: '',
    };
  },
  computed: {
    rows() {
      console.log(`QQQ: >> images.rows: this.showAll: ${ this.showAll }`);
      if (this.showAll) {
        return this.images;
      }
      return this.images.filter(this.isDeletable);
    },
    imageToBuildButtonDisabled() {
      console.log(`QQQ: >> imageToBuildButtonDisabled`);
      console.log(`QQQ: this.imageToBuild=[${ this.imageToBuild }]`);
      return this.imageToBuild.length === 0 || !this.imageToBuild.includes(':');
    },
    imageToPullButtonDisabled() {
      console.log(`QQQ: >> imageToPullButtonDisabled`);
      console.log(`QQQ: this.imageToPull=[${ this.imageToPull }]`);
      return this.imageToPull.length === 0;
    },
  },

  methods: {
    buttonOptions(row) {
      // console.log(`QQQ: >> buttonOptions(row: ${ row.imageName }`);
      const items = [];

      items.push({
        label: 'Push',
        action: this.doPush,
        value: row,
      });
      if (this.isDeletable(row)) {
        items.push({
          label: `Delete`,
          action: this.deleteImage,
          value: row,
        });
      }

      return items;
    },
    doClick(row, rowOption) {
      rowOption.action(row);
    },
    deleteImage(obj) {
      // console.log(`QQQ: >> deleteImage - obj.imageName: ${ obj.imageName }, obj.imageID: ${ obj.imageID } `);
      ipcRenderer.send('confirm-do-image-deletion', obj.imageName, obj.imageID);
    },
    doPush(obj) {
      ipcRenderer.send('do-image-push', obj.imageName, obj.imageID, obj.tag);
    },
    doBuildAnImage() {
      ipcRenderer.send('do-image-build', this.imageToBuild);
    },
    doPullAnImage() {
      ipcRenderer.send('do-image-pull', this.imageToPull);
    },
    isDeletable(row) {
      return row.imageName !== 'moby/buildkit' && row.imageName.indexOf('rancher/') !== 0;
    },
    handleCheckbox(value) {
      console.log(`QQQ: c/images: handleCheckbox(value: ${ value }) `);
      this.$emit('toggledShowAll', value);
    }
  }
};
</script>

<style scoped>
  input.inline {
    display: inline;
    width: 40em;
  }
</style>
