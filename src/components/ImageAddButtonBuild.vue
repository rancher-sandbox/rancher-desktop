<template>
  <div class="image-input">
    NOT FAIL
    <!-- <labeled-input
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
    </button> -->
  </div>
</template>

<script>
export default {
  name: 'image-add-button-build',

  data() {
    return { imageToPull: '' };
  }
};
</script>
