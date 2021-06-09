<!--
  - This is the Images table in the K8s page.
  -->
<template>
  <div>
    <div v-if="k8sIsRunning" ref="fullWindow">
      <SortableTable
        :headers="headers"
        :rows="rows"
        key-field="imageID"
        default-sort-by="imageName"
        :table-actions="false"
        :paging="true"
      >
        <template #header-middle>
          <Checkbox
            :disabled="showImageManagerOutput"
            :value="showAll"
            label="Show all images"
            @input="handleShowAllCheckbox"
          />
        </template>
        <template #row-actions="{ row }">
          <!-- We want to use the defalut rowActions from the SortableTable;
             - so just replace it with a dummy if we _don't_ want it on this row
            -->
          <i
            v-if="!hasDropdownActions(row)"
            disabled
            class="btn btn-sm icon icon-actions actions role-multi-action role-link select-all-check"
          />
        </template>
      </SortableTable>

      <Card :show-highlight-border="false" :show-actions="false">
        <template #title>
          <div class="type-title">
            <h3>Image Acquisition</h3>
          </div>
        </template>
        <template #body>
          <div class="labeled-input">
            <label for="imageToPull">Name of image to pull:</label>
            <input
              id="imageToPull"
              v-model="imageToPull"
              :disabled="showImageManagerOutput"
              type="text"
              placeholder="registry.example.com/repo/image"
              class="input-sm inline"
            >
            <button
              class="btn role-tertiary"
              :disabled="imageToPullButtonDisabled"
              @click="doPullAnImage"
            >
              Pull Image
            </button>
          </div>
          <div class="labeled-input">
            <label for="imageToBuild">Name of image to build:</label>
            <input
              id="imageToBuild"
              v-model="imageToBuild"
              :disabled="showImageManagerOutput"
              type="text"
              placeholder="registry.example.com/repo/image:tag"
              class="input-sm inline"
            >
            <button
              class="btn role-tertiary"
              :disabled="imageToBuildButtonDisabled"
              @click="doBuildAnImage"
            >
              Build Image...
            </button>
          </div>
          <div v-if="showImageManagerOutput">
            <hr>
            <button
              v-if="imageManagerProcessIsFinished"
              @click="closeOutputWindow"
            >
              Close Output to Continue
            </button>
            <textarea
              id="imageManagerOutput"
              ref="outputWindow"
              v-model="imageManagerOutput"
              :class="{ finished: imageManagerProcessIsFinished}"
              rows="10"
              readonly="true"
            />
          </div>
        </template>
      </Card>
    </div>
    <div v-else>
      <p>Waiting for Kubernetes to be ready</p>
    </div>
  </div>
</template>

<script>
import Card from '@/components/Card.vue';
import SortableTable from '@/components/SortableTable';
import Checkbox from '@/components/form/Checkbox';

import getImageOutputCuller from '@/utils/imageOutputCuller';
const { ipcRenderer } = require('electron');
const K8s = require('../k8s-engine/k8s');

export default {
  components: {
    Card, Checkbox, SortableTable
  },
  props:      {
    images: {
      type:     Array,
      required: true,
    },
    k8sState: {
      type:    Number,
      default: K8s.State.STOPPED,
    },
    showAll: {
      type:    Boolean,
      default: false,
    },
  },

  data() {
    return {
      kimRunningCommand: null,
      headers:           [
        {
          name:  'imageName',
          label: 'Image',
          sort:  ['imageName', 'tag', 'imageID'],
        },
        {
          name:  'tag',
          label: 'Tag',
          sort:  ['tag', 'imageName', 'imageID'],
        },
        {
          name:  'imageID',
          label: 'Image ID',
          sort:  ['imageID', 'imageName', 'tag'],
        },
        {
          name:  'size',
          label: 'Size',
          sort:  ['size', 'imageName', 'tag'],
        },
      ],
      imageToBuild:                     '',
      imageToPull:                      '',
      imageManagerOutput:               '',
      keepImageManagerOutputWindowOpen: false,
      fieldToClear:                     '',
      imageOutputCuller:                null,
    };
  },
  computed: {
    filteredImages() {
      if (this.showAll) {
        return this.images;
      }

      return this.images.filter(this.isDeletable);
    },
    rows() {
      for (const image of this.filteredImages) {
        if (!image.availableActions) {
          // The `availableActions` property is used by the ActionMenu to fill
          // out the menu entries.  Note that we need to modify the items
          // in-place, as SortableTable depends on object identity to manage its
          // selection state.
          image.availableActions = [
            {
              label:   'Push',
              action:  'doPush',
              enabled: this.isPushable(image),
              icon:    'icon icon-upload',
            },
            {
              label:   'Delete',
              action:  'deleteImage',
              enabled: this.isDeletable(image),
              icon:    'icon icon-delete',
            },
          ].filter(x => x.enabled);
        }
        // ActionMenu callbacks - SortableTable assumes that these methods live
        // on the rows directly.
        if (!image.doPush) {
          image.doPush = this.doPush.bind(this, image);
        }
        if (!image.deleteImage) {
          image.deleteImage = this.deleteImage.bind(this, image);
        }
      }

      return this.filteredImages;
    },
    k8sIsRunning() {
      return this.k8sState === K8s.State.STARTED;
    },
    showImageManagerOutput() {
      return !!this.kimRunningCommand || this.keepImageManagerOutputWindowOpen;
    },
    imageManagerProcessIsFinished() {
      return !this.kimRunningCommand;
    },
    imageToBuildButtonDisabled() {
      return this.showImageManagerOutput || !this.imageToBuild.includes(':');
    },
    imageToPullButtonDisabled() {
      return this.showImageManagerOutput || this.imageToPull.length === 0;
    },
  },

  mounted() {
    ipcRenderer.on('kim-process-ended', (event, status) => {
      this.handleProcessEnd(status);
    });
    ipcRenderer.on('kim-process-output', (event, data, isStderr) => {
      this.appendImageManagerOutput(data, isStderr);
    });
  },

  methods: {
    buttonOptions(row) {
      const items = [];

      if (this.isPushable(row)) {
        items.push({
          label:  'Push',
          action: this.doPush,
          value:  row,
        });
      }
      if (this.isDeletable(row)) {
        items.push({
          label:  `Delete`,
          action: this.deleteImage,
          value:  row,
        });
      }

      return items;
    },
    appendImageManagerOutput(data, isStderr) {
      if (!this.imageOutputCuller) {
        this.imageManagerOutput += data;
      } else {
        this.imageOutputCuller.addData(data);
        this.imageManagerOutput = this.imageOutputCuller.getProcessedData();
      }
    },
    closeOutputWindow(event) {
      this.keepImageManagerOutputWindowOpen = false;
      this.imageManagerOutput = '';
    },
    doClick(row, rowOption) {
      rowOption.action(row);
    },
    startRunningCommand(command) {
      this.keepImageManagerOutputWindowOpen = true;
      this.imageOutputCuller = getImageOutputCuller(command);

      if (this.$refs.fullWindow) {
        this.$refs.fullWindow.scrollTop = this.$refs.fullWindow.scrollHeight;
      }
    },
    deleteImage(obj) {
      this.kimRunningCommand = `delete ${ obj.imageName }:${ obj.tag }`;
      this.startRunningCommand('delete');
      ipcRenderer.send('confirm-do-image-deletion', obj.imageName.trim(), obj.imageID.trim());
    },
    doPush(obj) {
      this.kimRunningCommand = `push ${ obj.imageName }:${ obj.tag }`;
      this.startRunningCommand('push');
      ipcRenderer.send('do-image-push', obj.imageName.trim(), obj.imageID.trim(), obj.tag.trim());
    },
    doBuildAnImage() {
      this.kimRunningCommand = `build ${ this.imageToBuild }`;
      this.fieldToClear = 'imageToBuild';
      this.startRunningCommand('build');
      ipcRenderer.send('do-image-build', this.imageToBuild.trim());
    },
    doPullAnImage() {
      this.kimRunningCommand = `pull ${ this.imageToPull }`;
      this.fieldToClear = 'imageToPull';
      this.startRunningCommand('pull');
      ipcRenderer.send('do-image-pull', this.imageToPull.trim());
    },
    handleProcessEnd(status) {
      if (this.fieldToClear && status === 0) {
        this[this.fieldToClear] = ''; // JS way of doing indirection
        this.fieldToClear = '';
      }
      if (this.imageOutputCuller) {
        // Don't know what would make this null, but it happens on windows sometimes
        this.imageManagerOutput = this.imageOutputCuller.getProcessedData();
      }
      if (this.kimRunningCommand?.startsWith('delete') && this.imageManagerOutput === '') {
        this.closeOutputWindow(null);
      }
      this.kimRunningCommand = null;
    },
    isDeletable(row) {
      return row.imageName !== 'moby/buildkit' && !row.imageName.startsWith('rancher/');
    },
    isPushable(row) {
      // If it doesn't contain a '/', it's certainly not pushable,
      // but having a '/' isn't sufficient, but it's all we have to go on.
      return this.isDeletable(row) && row.imageName.includes('/');
    },
    hasDropdownActions(row) {
      return this.isDeletable(row);
    },
    handleShowAllCheckbox(value) {
      this.$emit('toggledShowAll', value);
    },
  },
};
</script>

<style lang="scss" scoped>
  .labeled-input > .btn {
    position: absolute;
    bottom: -1px;
    right: -1px;
    border-start-start-radius: var(--border-radius);
    border-radius: var(--border-radius) 0 0 0;
  }

  textarea#imageManagerOutput {
    font-family: monospace;
    font-size: smaller;
  }
  textarea#imageManagerOutput.finished {
    border: 2px solid dodgerblue;
  }
</style>
