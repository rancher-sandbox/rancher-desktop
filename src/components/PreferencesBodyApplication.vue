<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';
import Checkbox from '@/components/form/Checkbox.vue';

export default Vue.extend({
  name:       'preferences-body-application',
  components: { Checkbox },
  data() {
    return {
      sudoAllowedTooltip: `
        If checked, Rancher Desktop will attempt to acquire administrative
        credentials ("sudo access") when starting for some operations.  This
        allows for enhanced functionality, including bridged networking and
        default docker socket support.  Changes will only be applied next time
        Rancher Desktop starts.
      `,
    };
  },
  // TODO: Move mapgetters up to page that will be managing the modal and replace
  // usage with props
  computed: { ...mapGetters('applicationSettings', ['sudoAllowed']) },
  methods:  {
    onSudoAllowedChange(val: boolean) {
      this.$store.dispatch('applicationSettings/commitSudoAllowed', val);
    },
  }
});
</script>

<template>
  <div>
    <h3>
      Administrative Access
      <i v-tooltip="sudoAllowedTooltip" class="icon icon-info icon-lg" />
    </h3>
    <checkbox
      label="Allow Rancher Desktop to acquire administrative credentials (sudo access)"
      :value="sudoAllowed"
      @input="onSudoAllowedChange"
    />
  </div>
</template>
