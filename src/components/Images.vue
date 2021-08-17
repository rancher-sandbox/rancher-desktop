<!--
  - This is the Images table in the K8s page.
  -->
<template>
  <div>
    <div v-if="state === 'READY'" ref="fullWindow">
      <SortableTable
        ref="imagesTable"
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
            :label="t('images.manager.table.label')"
            @input="handleShowAllCheckbox"
          />
        </template>
      </SortableTable>

      <Card :show-highlight-border="false" :show-actions="false">
        <template #title>
          <div class="type-title">
            <h3>{{ t('images.manager.title') }}</h3>
          </div>
        </template>
        <template #body>
          <div class="labeled-input">
            <label for="imageToPull">{{ t('images.manager.input.pull.label') }}</label>
            <input
              id="imageToPull"
              v-model="imageToPull"
              :disabled="showImageManagerOutput"
              type="text"
              :placeholder="t('images.manager.input.pull.placeholder')"
              class="input-sm inline"
            >
            <button
              class="btn role-tertiary"
              :disabled="imageToPullButtonDisabled"
              @click="doPullAnImage"
            >
              {{ t('images.manager.input.pull.button') }}
            </button>
          </div>
          <div class="labeled-input">
            <label for="imageToBuild">{{ t('images.manager.input.build.label') }}</label>
            <input
              id="imageToBuild"
              v-model="imageToBuild"
              :disabled="showImageManagerOutput"
              type="text"
              :placeholder="t('images.manager.input.build.placeholder')"
              class="input-sm inline"
            >
            <button
              class="btn role-tertiary"
              :disabled="imageToBuildButtonDisabled"
              @click="doBuildAnImage"
            >
              {{ t('images.manager.input.build.button') }}
            </button>
          </div>
          <div v-if="showImageManagerOutput">
            <hr>
            <button
              v-if="imageManagerProcessIsFinished"
              class="role-tertiary"
              @click="closeOutputWindow"
            >
              {{ t('images.manager.close') }}
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
      <h3 v-if="state === 'K8S_UNREADY'">
        {{ t('images.state.k8sUnready') }}
      </h3>
      <h3 v-else-if="state === 'KIM_UNREADY'">
        {{ t('images.state.kimUnready') }}
      </h3>
      <h3 v-else>
        {{ t('images.state.unknown') }}
      </h3>
    </div>
  </div>
</template>

<script>
import { ipcRenderer } from 'electron';

import Card from '@/components/Card.vue';
import SortableTable from '@/components/SortableTable';
import Checkbox from '@/components/form/Checkbox';
import getImageOutputCuller from '@/utils/imageOutputCuller';

export default {
  components: {
    Card, Checkbox, SortableTable
  },
  props:      {
    images: {
      type:     Array,
      required: true,
    },
    state: {
      type:      String,
      default:   'K8S_UNREADY',
      validator: value => ['K8S_UNREADY', 'KIM_UNREADY', 'READY'].includes(value),
    },
    showAll: {
      type:    Boolean,
      default: false,
    },
  },

  data() {
    return {
      currentCommand: null,
      headers:
      [
        {
          name:  'imageName',
          label: this.t('images.manager.table.header.imageName'),
          sort:  ['imageName', 'tag', 'imageID'],
        },
        {
          name:  'tag',
          label: this.t('images.manager.table.header.tag'),
          sort:  ['tag', 'imageName', 'imageID'],
        },
        {
          name:  'imageID',
          label: this.t('images.manager.table.header.imageId'),
          sort:  ['imageID', 'imageName', 'tag'],
        },
        {
          name:  'size',
          label: this.t('images.manager.table.header.size'),
          sort:  ['size', 'imageName', 'tag'],
        },
      ],
      imageToBuild:                     '',
      imageToPull:                      '',
      imageManagerOutput:               '',
      keepImageManagerOutputWindowOpen: false,
      fieldToClear:                     '',
      imageOutputCuller:                null,
      mainWindowScroll:                 -1,
      postOpSuccessHandler:             null,
      postCloseOutputWindowHandler:     null,
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
              label:   this.t('images.manager.table.action.push'),
              action:  'doPush',
              enabled: this.isPushable(image),
              icon:    'icon icon-upload',
            },
            {
              label:   this.t('images.manager.table.action.delete'),
              action:  'deleteImage',
              enabled: this.isDeletable(image),
              icon:    'icon icon-delete',
            },
            {
              label:   this.t('images.manager.table.action.scan'),
              action:  'scanImage',
              enabled: true,
              icon:    'icon icon-info',
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
        if (!image.scanImage) {
          image.scanImage = this.scanImage.bind(this, image);
        }
      }

      return this.filteredImages;
    },
    showImageManagerOutput() {
      return !!this.currentCommand || this.keepImageManagerOutputWindowOpen;
    },
    imageManagerProcessIsFinished() {
      return !this.currentCommand;
    },
    imageToBuildButtonDisabled() {
      return this.showImageManagerOutput || !this.imageToBuild.includes(':');
    },
    imageToPullButtonDisabled() {
      return this.showImageManagerOutput || this.imageToPull.length === 0;
    },
  },

  mounted() {
    ipcRenderer.on('kim-process-cancelled', (event) => {
      this.handleProcessCancelled();
    });
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
          label:  this.t('images.table.action.push'),
          action: this.doPush,
          value:  row,
        });
      }
      if (this.isDeletable(row)) {
        items.push({
          label:  this.t('images.table.action.delete'),
          action: this.deleteImage,
          value:  row,
        });
      }
      items.push({
        label:  this.t('images.table.action.scan'),
        action: this.scanImage,
        value:  row,
      });

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
      if (this.postCloseOutputWindowHandler) {
        this.postCloseOutputWindowHandler();
        this.postCloseOutputWindowHandler = null;
      } else {
        this.imageManagerOutput = '';
        if (this.mainWindowScroll >= 0) {
          this.$nextTick(() => {
            this.$refs.fullWindow.parentElement.parentElement.scrollTop = this.mainWindowScroll;
            this.mainWindowScroll = -1;
          });
        }
      }
    },
    doClick(row, rowOption) {
      // Do this in case a handler from the previous operation didn't fire due to an error.
      rowOption.action(row);
    },
    startRunningCommand(command) {
      this.keepImageManagerOutputWindowOpen = true;
      this.imageOutputCuller = getImageOutputCuller(command);

      if (this.$refs.fullWindow) {
        // move to the bottom
        this.$nextTick(() => {
          this.$refs.fullWindow.parentElement.parentElement.scrollTop = this.$refs.fullWindow.scrollHeight;
        });
      }
    },
    deleteImage(obj) {
      if (!window.confirm(`Delete image ${ obj.imageName }:${ obj.tag }?`)) {
        return;
      }
      this.currentCommand = `delete ${ obj.imageName }:${ obj.tag }`;
      this.mainWindowScroll = this.$refs.fullWindow.parentElement.parentElement.scrollTop;
      this.postOpSuccessHandler = this.postDeleteSuccessHandler;
      this.startRunningCommand('delete');
      ipcRenderer.send('do-image-deletion', obj.imageName.trim(), obj.imageID.trim());
    },
    postDeleteSuccessHandler() {
      if (this.imageManagerOutput === '') {
        this.closeOutputWindow(null);
      }
    },
    doPush(obj) {
      this.currentCommand = `push ${ obj.imageName }:${ obj.tag }`;
      this.mainWindowScroll = this.$refs.fullWindow.parentElement.parentElement.scrollTop;
      this.startRunningCommand('push');
      ipcRenderer.send('do-image-push', obj.imageName.trim(), obj.imageID.trim(), obj.tag.trim());
    },
    doBuildAnImage() {
      if (this.highlightExistingImage(this.imageToBuild)) {
        return;
      }
      this.currentCommand = `build ${ this.imageToBuild }`;
      this.fieldToClear = 'imageToBuild';
      this.postCloseOutputWindowHandler = this.scrollToNewImage(this.imageToBuild);
      this.startRunningCommand('build');
      ipcRenderer.send('do-image-build', this.imageToBuild.trim());
    },
    doPullAnImage() {
      if (this.highlightExistingImage(this.imageToPull)) {
        return;
      }
      this.currentCommand = `pull ${ this.imageToPull }`;
      this.fieldToClear = 'imageToPull';
      this.postCloseOutputWindowHandler = this.scrollToNewImage(this.imageToPull);
      this.startRunningCommand('pull');
      ipcRenderer.send('do-image-pull', this.imageToPull.trim());
    },
    /**
     * If the named image is loaded, scroll to it and return true.
     * Otherwise return false.
     * @param fullImageName {string{}}
     * @returns {boolean}
     */
    highlightExistingImage(fullImageName) {
      const [imageName, tag] = this.parseFullImageName(fullImageName);

      const image = this.getImageByNameAndTag(imageName, tag);

      if (image) {
        window.alert(`Image ${ fullImageName } is already loaded`);
        this.scrollToImage(image);

        return true;
      }

      return false;
    },
    /**
     * syntax of a fully qualified tag could start with <hostname>:<port>/
     * so a colon precedes a tag only if its followed only by valid tag characters
     * @param fullImageName {string}
     * @returns {[string, string]}
     */
    parseFullImageName(fullImageName) {
      const m = /^(.+?):([-._A-Za-z0-9]+)$/.exec(fullImageName);

      return m ? [m[1], m[2]] : [fullImageName, 'latest'];
    },
    getImageByNameAndTag(imageName, tag) {
      return this.images.find(image => image.imageName === imageName && image.tag === tag);
    },
    scrollToImage(image) {
      const row = this.$refs.imagesTable.$el.querySelector(`tr[data-node-id="${ image.imageID }"]`);

      if (row) {
        this.$nextTick(() => {
          row.scrollIntoView();
        });
      } else {
        console.log(`Can't find row for ${ image.imageName }:${ image.tag } in the image table`);
      }
    },
    scrollToNewImage(imageToPull) {
      return () => {
        if (this.imageManagerOutput.trimStart().startsWith('Error:')) {
          this.imageManagerOutput = '';

          return;
        }
        this.imageManagerOutput = '';

        const [imageName, tag] = this.parseFullImageName(imageToPull);
        const image = this.getImageByNameAndTag(imageName, tag);

        if (!image) {
          console.log(`Can't find ${ imageToPull } ([${ imageName }, ${ tag }]) in the table`);
          console.log(`Image names: ${ this.images.map(img => `[ ${ img.imageName }:${ img.tag }]`).join('; ') }`);

          return;
        }
        this.scrollToImage(image);
      };
    },

    scanImage(obj) {
      const taggedImageName = `${ obj.imageName.trim() }:${ obj.tag.trim() }`;

      this.currentCommand = `scan image ${ taggedImageName }`;
      this.mainWindowScroll = this.$refs.fullWindow.parentElement.parentElement.scrollTop;
      this.startRunningCommand('trivy-image');
      ipcRenderer.send('do-image-scan', taggedImageName);
    },
    handleProcessCancelled() {
      this.closeOutputWindow(null);
      this.currentCommand = null;
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
      this.currentCommand = null;
      if (this.postOpSuccessHandler) {
        this.postOpSuccessHandler();
        this.postOpSuccessHandler = null;
      }
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
