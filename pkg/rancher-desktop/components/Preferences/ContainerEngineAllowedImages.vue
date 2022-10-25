<script lang="ts">
import Vue from 'vue';

import RdFieldset from '@/components/form/RdFieldset.vue';
import { Settings } from '@/config/settings';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-container-engine-allowed-images',
  components: { RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
});
</script>

<template>
  <div class="container-engine-allowed-images">
    <rd-fieldset
      data-test="allowedImages"
      :legend-text="t('allowedImages.label')"
    >
    </rd-fieldset>
  </div>
</template>
