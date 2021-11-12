<script>
import Card from '@/components/Card.vue';

export default {
  name: 'images-output-window',

  components: { Card },

  data() {
    return {
      keepImageManagerOutputWindowOpen: false,
      currentCommand:                   null,
      postCloseOutputWindowHandler:     null,
      imageManagerOutput:               '',
    };
  },

  computed: {
    showImageManagerOutput() {
      return this.keepImageManagerOutputWindowOpen;
    },
    imageManagerProcessIsFinished() {
      return !this.currentCommand;
    },
  },

  methods: {
    closeOutputWindow() {
      this.keepImageManagerOutputWindowOpen = false;
      if (this.postCloseOutputWindowHandler) {
        this.postCloseOutputWindowHandler();
        this.postCloseOutputWindowHandler = null;
      } else {
        this.imageManagerOutput = '';
      }
    },
  }
};
</script>

<template>
  <card
    v-if="showImageManagerOutput"
    :show-highlight-border="false"
    :show-actions="false"
  >
    <template #title>
      <div class="type-title">
        <h3>{{ t('images.manager.title') }}</h3>
      </div>
    </template>
    <template #body>
      <div>
        <button
          v-if="imageManagerProcessIsFinished"
          class="role-tertiary"
          @click="closeOutputWindow"
        >
          {{ t('images.manager.close') }}
        </button>
        <textarea
          id="imageManagerOutput"
          v-model="imageManagerOutput"
          :class="{ success: imageManagerProcessFinishedWithSuccess, failure: imageManagerProcessFinishedWithFailure }"
          rows="10"
          readonly="true"
        />
      </div>
    </template>
  </card>
</template>
