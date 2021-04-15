<!--
  - This is the Images table in the K8s page.
  -->
<template>
  <div>
    <div v-if="k8sIsRunning" ref="fullWindow">
      <Checkbox
        :disabled="showImageManagerOutput"
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
          <div v-if="hasDropdownActions(row)">
            <ButtonDropdown
              :button-label="'...'"
              :disabled="showImageManagerOutput"
              :dropdown-options="buttonOptions(row)"
              size="sm"
              @click-action="(rowOption) => doClick(row, rowOption)"
            />
          </div>
          <div v-else></div>
        </template>
      </SortableTable>

      <hr>
      Name of image to pull:
      <input
        v-model="imageToPull"
        :disabled="showImageManagerOutput"
        type="text"
        maxlength="50"
        placeholder="docker image"
        class="input-sm inline"
      >
      <button
        class="btn btn-sm role-tertiary"
        :disabled="imageToPullButtonDisabled"
        @click="doPullAnImage"
      >
        Pull an Image...
      </button>
      <hr>
      Name of image to build:
      <input
        v-model="imageToBuild"
        :disabled="showImageManagerOutput"
        type="text"
        maxlength="50"
        placeholder="image name with tag"
        class="input-sm inline"
      >
      <button
        class="btn btn-sm role-tertiary"
        :disabled="imageToBuildButtonDisabled"
        @click="doBuildAnImage"
      >
        Build an Image...
      </button>
      <hr>
      <div v-if="showImageManagerOutput">
        <textarea
          id="imageManagerOutput"
          ref="outputWindow"
          v-model="imageManagerOutput"
          rows="10"
        />
        <button
          v-if="imageManagerProcessIsFinished"
          @click="closeTheOutputWindow"
        >
          Close This Output
        </button>
      </div>
    </div>
    <div v-else>
      <p>Kubernetes isn't running yet</p>
    </div>
  </div>
</template>

<script>
import ButtonDropdown from '@/components/ButtonDropdown';
import SortableTable from '@/components/SortableTable';
import Checkbox from '@/components/form/Checkbox';

const { ipcRenderer } = require('electron');
const K8s = require('../k8s-engine/k8s');

export default {
  components: {
    ButtonDropdown, Checkbox, SortableTable
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
      imageToBuild:                     '',
      imageToPull:                      '',
      imageManagerOutput:               '',
      keepImageManagerOutputWindowOpen: false,
      fieldToClear:                     null,
    };
  },
  computed: {
    rows() {
      if (this.showAll) {
        return this.images;
      }

      return this.images.filter(this.isDeletable);
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
      return this.showImageManagerOutput || this.imageToBuild.length === 0 || !this.imageToBuild.includes(':');
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
      const outputWindow = this.$refs.outputWindow;

      this.imageManagerOutput += data;
      if (outputWindow) {
        outputWindow.scrollTop = outputWindow.scrollHeight;
      }
    },
    closeTheOutputWindow(event) {
      this.keepImageManagerOutputWindowOpen = false;
      this.imageManagerOutput = '';
    },
    doClick(row, rowOption) {
      rowOption.action(row);
    },
    startRunningCommand() {
      this.keepImageManagerOutputWindowOpen = true;

      if (this.$refs.fullWindow) {
        this.$refs.fullWindow.scrollTop = this.$refs.fullWindow.scrollHeight;
      }
    },
    deleteImage(obj) {
      this.kimRunningCommand = `delete ${ obj.imageName }:${ obj.tag }`;
      ipcRenderer.send('confirm-do-image-deletion', obj.imageName, obj.imageID);
      this.startRunningCommand();
    },
    doPush(obj) {
      this.kimRunningCommand = `push ${ obj.imageName }:${ obj.tag }`;
      ipcRenderer.send('do-image-push', obj.imageName, obj.imageID, obj.tag);
      this.startRunningCommand();
    },
    doBuildAnImage() {
      this.kimRunningCommand = `build ${ this.imageToBuild }`;
      this.fieldToClear = this.imageToBuild;
      ipcRenderer.send('do-image-build', this.imageToBuild);
      this.startRunningCommand();
    },
    doPullAnImage() {
      this.kimRunningCommand = `pull ${ this.imageToPull }`;
      this.fieldToClear = this.imageToPull;
      ipcRenderer.send('do-image-pull', this.imageToPull);
      this.startRunningCommand();
    },
    handleProcessEnd(status) {
      this.kimRunningCommand = null;
      if (this.fieldToClear) {
        this.fieldToClear = '';
      }
      if (this.$refs.fullWindow) {
        this.$refs.fullWindow.scrollTop = this.$refs.fullWindow.scrollHeight;
      }
    },
    isDeletable(row) {
      return row.imageName !== 'moby/buildkit' && row.imageName.indexOf('rancher/') !== 0;
    },
    isPushable(row) {
      // If it doesn't contain a '/', it's certainly not pushable,
      // but having a '/' isn't sufficient, but it's all we have to go on.
      return this.isDeletable(row) && row.imageName.includes('/');
    },
    hasDropdownActions(row) {
      return this.isDeletable(row);
    },
    handleCheckbox(value) {
      this.$emit('toggledShowAll', value);
    },
  },
};
</script>

<style scoped>
  input.inline {
    display: inline;
    width: 40em;
  }
</style>
