<!--
  - This is the Images table in the K8s page.
  -->
<template>
  <div>
    <div v-if="state === 'READY'" ref="fullWindow">
      <SortableTable
        ref="imagesTable"
        class="imagesTable"
        :headers="headers"
        :rows="rows"
        key-field="imageID"
        default-sort-by="imageName"
        :table-actions="false"
        :paging="true"
      >
        <template #header-middle>
          <Checkbox
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
              :disabled="imageToPullTextFieldIsDisabled"
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
              :disabled="imageToBuildTextFieldIsDisabled"
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
              :class="{ success: imageManagerProcessFinishedWithSuccess, failure: imageManagerProcessFinishedWithFailure }"
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
      currentCommand:   null,
      completionStatus: false,
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
    imageToPullTextFieldIsDisabled() {
      return this.currentCommand || this.keepImageManagerOutputWindowOpen;
    },
    imageToPullButtonDisabled() {
      return this.imageToPullTextFieldIsDisabled || !this.imageToPull;
    },
    imageToBuildTextFieldIsDisabled() {
      return this.currentCommand || this.keepImageManagerOutputWindowOpen;
    },
    imageToBuildButtonDisabled() {
      return this.imageToPullTextFieldIsDisabled || !this.imageToBuild;
    },
    showImageManagerOutput() {
      return this.keepImageManagerOutputWindowOpen;
    },
    imageManagerProcessIsFinished() {
      return !this.currentCommand;
    },
    imageManagerProcessFinishedWithSuccess() {
      return this.imageManagerProcessIsFinished && this.completionStatus;
    },
    imageManagerProcessFinishedWithFailure() {
      return this.imageManagerProcessIsFinished && !this.completionStatus;
    },
  },

  mounted() {
    this.main = document.getElementsByTagName('main')[0];
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
      // Delay moving to the output-window until there's a reason to
      if (!this.keepImageManagerOutputWindowOpen) {
        if (!data?.trim()) {
          // Could be just a newline at the end of processing, so wait
          return;
        }
        this.keepImageManagerOutputWindowOpen = true;
        this.scrollToOutputWindow();
      }
    },
    scrollToOutputWindow() {
      if (this.main) {
        // move to the bottom
        this.$nextTick(() => {
          this.main.scrollTop = this.main.scrollHeight;
        });
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
            try {
              this.main.scrollTop = this.mainWindowScroll;
            } catch (e) {
              console.log(`Trying to reset scroll to ${ this.mainWindowScroll }, got error:`, e);
            }
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
      this.imageOutputCuller = getImageOutputCuller(command);
    },
    async deleteImage(obj) {
      const options = {
        message:   `Delete image ${ obj.imageName }:${ obj.tag }?`,
        type:      'question',
        buttons:   ['Yes', 'No'],
        defaultId: 1,
        title:     'Confirming image deletion',
        cancelId:  1
      };
      const result = await ipcRenderer.invoke('show-message-box', options);

      if (result.response === 1) {
        return;
      }
      this.currentCommand = `delete ${ obj.imageName }:${ obj.tag }`;
      this.mainWindowScroll = this.main.scrollTop;
      this.startRunningCommand('delete');
      ipcRenderer.send('do-image-deletion', obj.imageName.trim(), obj.imageID.trim());
    },
    doPush(obj) {
      this.currentCommand = `push ${ obj.imageName }:${ obj.tag }`;
      this.mainWindowScroll = this.main.scrollTop;
      this.startRunningCommand('push');
      ipcRenderer.send('do-image-push', obj.imageName.trim(), obj.imageID.trim(), obj.tag.trim());
    },
    doBuildAnImage() {
      const imageName = this.imageToBuild.trim();

      this.currentCommand = `build ${ imageName }`;
      this.fieldToClear = 'imageToBuild';
      this.postCloseOutputWindowHandler = () => this.scrollToImageOnSuccess(imageName);
      this.startRunningCommand('build');
      ipcRenderer.send('do-image-build', imageName);
    },
    doPullAnImage() {
      const imageName = this.imageToPull.trim();

      this.currentCommand = `pull ${ imageName }`;
      this.fieldToClear = 'imageToPull';
      this.postCloseOutputWindowHandler = () => this.scrollToImageOnSuccess(imageName);
      this.startRunningCommand('pull');
      ipcRenderer.send('do-image-pull', imageName);
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
      return this.images.find(image => image.imageName === imageName &&
        (image.tag === tag || (image.tag === '<none>' && tag === 'latest')));
    },
    scrollToImage(image) {
      const row = this.$refs.imagesTable.$el.querySelector(`tr[data-node-id="${ image.imageID }"]`);

      if (row) {
        this.$nextTick(() => {
          row.scrollIntoView();
          row.addEventListener('animationend', this.animationEndHandler);
          row.classList.add('highlightFade');
        });
      } else {
        console.log(`Can't find row for ${ image.imageName }:${ image.tag } in the image table`);
      }
    },
    animationEndHandler(event) {
      const row = event.target;

      row.classList.remove('highlightFade');
      row.removeEventListener('animationend', this.animationEndHandler);
    },
    /**
     * Does three things:
     * 1. Verifies the operation ran successfully - in which case there might be a new image
     * 2. If successful, finds the image in the table
     * 3. Scrolls to that image and highlights it (via `scrollToImage()`)
     *
     * Currently called only as a postCloseOutputWindowHandler
     */
    scrollToImageOnSuccess(taggedImageName) {
      const operationEndedBadly = this.imageManagerOutput.trimStart().startsWith('Error:');
      const [imageName, tag] = this.parseFullImageName(taggedImageName);
      const image = this.getImageByNameAndTag(imageName, tag);

      this.imageManagerOutput = '';
      if (!image) {
        if (!operationEndedBadly) {
          console.log(`Can't find ${ taggedImageName } ([${ imageName }, ${ tag }]) in the table`, this.images);
          console.log(`Image names: ${ this.images.map(img => `[ ${ img.imageName }:${ img.tag }]`).join('; ') }`);
        }
        // Otherwise we wouldn't expect to find the tag in the list

        return;
      }
      this.scrollToImage(image);
    },

    scanImage(obj) {
      const taggedImageName = `${ obj.imageName.trim() }:${ obj.tag.trim() }`;

      this.currentCommand = `scan image ${ taggedImageName }`;
      this.mainWindowScroll = this.main.scrollTop;
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
      this.completionStatus = status === 0;
      if (!this.keepImageManagerOutputWindowOpen) {
        this.closeOutputWindow();
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
  textarea#imageManagerOutput.success {
    border: 2px solid var(--success);
  }
  textarea#imageManagerOutput.failure {
    border: 2px solid var(--error);
  }

  @keyframes highlightFade {
    from {
      background: var(--accent-btn);
    } to {
      background: transparent;
    }
  }

  .imagesTable::v-deep tr.highlightFade {
    animation: highlightFade 1s;
  }
</style>
