<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';
import Checkbox from '@/components/form/Checkbox.vue';
import RdFieldset from '@/components/form/RdFieldset.vue';

export default Vue.extend({
  name:       'preferences-application-behavior',
  components: { Checkbox, RdFieldset },
  data() {
    return {
      sudoAllowedTooltip: `
        If checked, Rancher Desktop will attempt to acquire administrative
        credentials ("sudo access") when starting for some operations.  This
        allows for enhanced functionality, including bridged networking and
        default docker socket support.  Changes will only be applied next time
        Rancher Desktop starts.
      `,
      automaticUpdates: true,
      statistics:       false,
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
  <div class="application-behavior">
    <rd-fieldset
      legend-text="Administrative Access"
      :legend-tooltip="sudoAllowedTooltip"
    >
      <checkbox
        label="Allow Rancher Desktop to acquire administrative credentials (sudo access)"
        :value="sudoAllowed"
        @input="onSudoAllowedChange"
      />
    </rd-fieldset>
    <rd-fieldset
      legend-text="Automatic Updates"
    >
      <checkbox
        v-model="automaticUpdates"
        label="Check for updates automatically"
      />
    </rd-fieldset>
    <rd-fieldset
      legend-text="Statistics"
    >
      <checkbox
        v-model="statistics"
        label="Allow collection of anonymous statistics to help us improve Rancher Desktop"
      />
    </rd-fieldset>
  </div>
</template>

<style lang="scss" scoped>
  .application-behavior {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
