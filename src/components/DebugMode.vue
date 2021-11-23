<template>
  <div class="system-preferences">
    <div class="checkbox">
      <Checkbox
        :value="debug"
        label="Enable debug mode"
        @input="toggleDebug"
      />
    </div>
  </div>
</template>

<script>
import Checkbox from '@/components/form/Checkbox';

export default {
  components: { Checkbox },
  props:      {
    debug: {
      type:    Boolean,
      default: false,
    },
  },
  methods: {
    toggleDebug(value) {
      this.$emit('updateDebug', value);
    },
  },
};
</script>
