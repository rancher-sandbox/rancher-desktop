<!--
  - This is the Images table in the K8s page.
  -->
<template>
  <div>
    <div v-if="k8sIsRunning" ref="fullWindow">
      <Checkbox
        :disabled="showImageManagerOutput"
        :value="showAll"
        label="Show all images"
        @input="handleShowAllCheckbox"
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
          <div>
            <ButtonDropdown
              v-if="hasDropdownActions(row)"
              :disabled="showImageManagerOutput"
              :dropdown-options="buttonOptions(row)"
              button-label="..."
              size="sm"
              @click-action="(rowOption) => doClick(row, rowOption)"
            />
          </div>
        </template>
      </SortableTable>

      <hr>
      <div class="wrappedAction">
        <label>Name of image to pull:</label>
        <input
          v-model="imageToPull"
          :disabled="showImageManagerOutput"
          type="text"
          placeholder="docker image"
          class="input-sm inline"
        >
        <button
          class="btn btn-sm role-tertiary inline"
          :disabled="imageToPullButtonDisabled"
          @click="doPullAnImage"
        >
          Pull Image
        </button>
      </div>
      <hr>
      <div class="wrappedAction">
        <label>Name of image to build:
          <input
            v-model="imageToBuild"
            :disabled="showImageManagerOutput"
            type="text"
            placeholder="image name with tag"
            class="input-sm inline"
          >
        </label>
        <button
          class="btn btn-sm role-tertiary"
          :disabled="imageToBuildButtonDisabled"
          @click="doBuildAnImage"
        >
          Build Image...
        </button>
      </div>
      <hr>
      <div v-if="showImageManagerOutput">
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
          rows="10"
          readonly="true"
        />
      </div>
    </div>
    <div v-else>
      <p>Waiting for Kubernetes to be ready</p>
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
      const outputWindow = this.$refs.outputWindow;

      this.imageManagerOutput += data;
      if (outputWindow) {
        outputWindow.scrollTop = outputWindow.scrollHeight;
      }
    },
    closeOutputWindow(event) {
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
      if (this.fieldToClear) {
        this.fieldToClear = '';
      }
      if (this.kimRunningCommand.startsWith('delete') && this.imageManagerOutput === '') {
        this.closeOutputWindow(null);
      } else if (this.$refs.fullWindow) {
        this.$refs.fullWindow.scrollTop = this.$refs.fullWindow.scrollHeight;
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

<style scoped>
  input.inline {
    display: inline;
    width: 20em;
  }

  div.wrappedAction {
    display: flex;
    flex-direction: row;
  }

  div.wrappedAction > label {
    flex: auto;
  }

  div.wrappedAction > input {
    flex: 50%;
  }

  div.wrappedAction > button {
    flex: 15%;
    margin-left: 1em;
  }

  textarea#imageManagerOutput {
    font-family: monospace;
    font-size: smaller;
  }
</style>
