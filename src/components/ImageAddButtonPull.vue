<template>
  <div class="image-input">
    <labeled-input
      id="imageToPull"
      v-model="imageToPull"
      type="text"
      :disabled="!~imageToPullTextFieldIsDisabled"
      :placeholder="t('images.manager.input.pull.placeholder')"
      :label="t('images.manager.input.pull.label')"
    />
    <button
      class="btn role-primary btn-large"
      :disabled="imageToPullButtonDisabled"
      @click="doPullAnImage"
    >
      {{ t('images.manager.input.pull.button') }}
    </button>
  </div>
</template>

<script>
import LabeledInput from '@/components/form/LabeledInput.vue';
export default {
  name: 'image-add-button-pull',

  components: { LabeledInput },

  props: {
    currentCommand: {
      type:    String,
      default: ''
    },
    keepImageManagerOutputWindowOpen: {
      type:    Boolean,
      default: false
    }
  },

  data() {
    return { imageToPull: '' };
  },

  computed: {
    imageToPullButtonDisabled() {
      return this.imageToPullTextFieldIsDisabled || !this.imageToPull;
    },
    imageToPullTextFieldIsDisabled() {
      return this.currentCommand || this.keepImageManagerOutputWindowOpen;
    },
  },

  methods: {
    doPullAnImage() {
      this.$emit('click', { action: 'pull', image: this.imageToPull });
    }
  }
};
</script>
