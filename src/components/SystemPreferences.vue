<script>
  import LabeledInput from './form/LabeledInput.vue';
  import PreferenceValidators from '../mixins/preference-validators';
  const runningVue2 = true;
  export default {
    components: {
      LabeledInput
    },
    mixins: [PreferenceValidators],
    props: {
      memoryInGB: {
        type: String,
        default: "2"
      },
      numberCPUs: {
        type: Number,
        default: 2
      },
        availMemoryInGB: {
            type: Number,
            default: 0
        },
        availNumCPUs: {
            type: Number,
            default: 0
        }
    },
      methods: {
          updatedMemory(event) {
            this.emitEvent(event, 'updateMemory');
          },
          updatedCPU(event) {
            this.emitEvent(event, 'updateCPU');
          },
        /**
         * emitEvent
         * @event event - either an event object or a string
         * In v2, event is only a string
         * In v3, this gets called twice, once with event as an event object, then as a string.
         */
        emitEvent(event, eventName) {
          try {
            if (runningVue2) {
              this.$emit(eventName, event);
            } else {
              if (typeof(param) !== "string") {
                this.$emit(eventName, event);
              }
            }
          } catch(e) {
            console.log(`error doing ${eventName}:${e}`)
          }
        }
      },
  }
</script>

<template>
  <div class="system-preferences">
    <p>System Preferences:</p>
    <div id="memoryInGBWrapper">
      <LabeledInput
        :value="memoryInGB"
        label="memory in GB"
        @input="updatedMemory"
        />
      <div>
        <p v-if="memoryValueIsntValid" class="bad-input">
          Invalid value: {{ invalidMemoryValueReason }}
        </p>
      </div>
    </div>

    <div id="numCPUWrapper">
      <LabeledInput
        :value="numberCPUs"
        type="number"
        label="number of CPUs"
        @input="updatedCPU"
      />
      <div>
        <p v-if="numCPUsValueIsntValid" class="bad-input">
          Invalid value: {{ invalidNumCPUsValueReason }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>

div.system-preferences div.labeled-input {
    width: 15em;
    margin-bottom: 5pt;
}

div.system-preferences p.bad-input {
  border: red 1px dotted;
  width: 40em;
    overflow: visible;
    font-size: 11pt;
    margin-top: -4pt;
    margin-bottom: 5pt;
}

</style>
