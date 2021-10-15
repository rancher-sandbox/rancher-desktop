<template>
  <div class="image-input">
    <labeled-input
      id="imageToPull"
      v-model="image"
      type="text"
      class="image"
      :disabled="isInputDisabled"
      :placeholder="t('images.manager.input.pull.placeholder')"
      :label="t('images.manager.input.pull.label')"
      @keyup.enter.native="doPullAnImage"
    />
    <button
      class="btn role-primary btn-lg"
      :disabled="isButtonDisabled"
      @click="doPullAnImage"
    >
      {{ t('images.manager.input.pull.button') }}
    </button>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import LabeledInput from './form/LabeledInput.vue';

export default Vue.extend({
  name: 'image-add-button-pull',

  components: { LabeledInput },

  props: {
    currentCommand: {
      type:    String,
      default: ''
    },
    keepOutputWindowOpen: {
      type:    Boolean,
      default: false
    }
  },

  data() {
    return { image: '' };
  },

  computed: {
    isButtonDisabled(): boolean {
      return this.isInputDisabled || !this.image;
    },
    isInputDisabled(): boolean {
      return !~this.currentCommand || this.keepOutputWindowOpen;
    },
  },

  methods: {
    doPullAnImage() {
      this.$emit('click', { action: 'pull', image: this.image });
    }
  }
});
</script>

<style lang="scss" scoped>
  .image {
    min-width: 32rem;
  }

  .btn {
    margin-bottom: 14px;
  }
</style>
