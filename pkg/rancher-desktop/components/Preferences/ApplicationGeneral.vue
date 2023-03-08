<script lang="ts">
import Vue from 'vue';
import { required, minLength, between } from 'vuelidate/lib/validators';
import { mapGetters } from 'vuex';

import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:  'preferences-application-general',
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  data() {
    return {

      // vuelidate example
      name: '',
      age:  null,

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

  validations: {
    name: {
      required,
      minLength: minLength(4),
    },
    age: { between: between(20, 30) },
  },

  computed: {
    ...mapGetters('preferences', ['isPlatformWindows']),
    isSudoAllowed(): boolean {
      return this.preferences?.application?.adminAccess ?? false;
    },
    canAutoUpdate(): boolean {
      return this.preferences?.application.updater.enabled ?? false;
    },
  },

  methods: {
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
  },
});
</script>

<template>
  <div class="application-general">
    <div id="name_field" class="field">
      <div class="form-group" :class="{ 'form-group--error': $v.name.$error }">
        <label class="form__label">Name</label>
        <input
          v-model.trim="$v.name.$model"
          class="form__input"
        />
        <div
          v-if="!$v.name.required"
          class="error"
        >
          Field is required
        </div>
        <div
          v-if="!$v.name.minLength"
          class="error"
        >
          Name must have at least {{ $v.name.$params.minLength.min }} letters.
        </div>
      </div>
    </div>

    <div id="age_field" class="field">
      <div class="form-group" :class="{ 'form-group--error': $v.age.$error }">
        <label class="form__label">Age</label>
        <input
          v-model.trim="$v.age.$model"
          class="form__input"
        />
        <div
          v-if="!$v.age.between"
          class="error"
        >
          Must be between {{ $v.age.$params.between.min }} and {{ $v.age.$params.between.max }}
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .application-general {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .field {
    margin-top: 2px;
  }

  .form__input {
    margin: 5px;
  }

  .form-group--error {
    color: red;

    .form__input {
      border-color: red;

      outline-color: none;
      outline-style: none;
      outline-width: none;

    }
  }
</style>
