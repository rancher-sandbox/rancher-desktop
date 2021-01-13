<script>
  import LabeledInput from './form/LabeledInput.vue'
  const runningVue2 = true;
  export default {
    components: {
      LabeledInput
    },
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
              // param.preventDefault();
              // param.stopPropagation();
            }
          } catch(e) {
            console.log(`error doing ${eventName}:${e}`)
          }
        }
      },
    computed: {

      invalidMemoryValueReason: function() {
        let value = this.memoryInGB;
        // This might not work due to floating-point inaccuracies,
        // but testing showed it works for up to 3 decimal points.
        if (value === "") {
          return "No value provided";
        }
        if (!/^-?\d+(?:\.\d*)?$/.test(value)) {
          return "Contains non-numeric characters";
        }
        let numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
          return `${value} isnt numeric`
        }
        if (numericValue < 2) {
          return "Specified value is too low, must be at least 2 (GB)";
        }
        if (numericValue > this.availMemoryInGB && this.availMemoryInGB) {
          let etre = this.availMemoryInGB == 1 ? "is" : "are";
          return `Specified value is too high, only ${this.availMemoryInGB} GB ${etre} available`;
        }
        return '';
      },

      memoryValueIsValid: function() {
        return !this.invalidMemoryValueReason;
      },
      memoryValueIsntValid: function() {
        return !this.memoryValueIsValid;
      },
      invalidNumCPUsValueReason: function() {
        let value = this.numberCPUs;
        let numericValue = parseFloat(value);
        if (typeof (value) === "string") {
          numericValue = parseFloat(value);
          if (isNaN(numericValue)) {
            return `${value} isnt numeric`
          }
        } else {
          numericValue = value;
        }
        if (numericValue < 2) {
          return "Specified value is too low, must be at least 2 (GB)";
        }
        if (numericValue > this.availNumCPUs && this.availNumCPUs) {
          const pluralSuffix = this.availNumCPUs == 1 ? "" : "s";
          const isVerb = this.availNumCPUs == 1 ? "is" : "are";
          return `Specified value is too high, only ${this.availNumCPUs} CPU${pluralSuffix} ${isVerb} available`;
        }
        return '';
      },

      numCPUsValueIsValid: function() {
        return !this.invalidNumCPUsValueReason;
      },
      numCPUsValueIsntValid: function() {
        return !this.numCPUsValueIsValid;
      },
    }
  }
</script>

<template>
  <div class="minikube-settings">
    <p>Minikube Settings:</p>
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

div.minikube-settings div.labeled-input {
    width: 15em;
    margin-bottom: 5pt;
}

div.minikube-settings p.bad-input {
  border: red 1px dotted;
  width: 40em;
    overflow: visible;
    font-size: 11pt;
    margin-top: -4pt;
    margin-bottom: 5pt;
}

</style>
