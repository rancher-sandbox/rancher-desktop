<script>
  import LabeledInput from '@/src/components/form/LabeledInput.vue'
  export default {
    components: {
      LabeledInput
    },
      data() {
          return {
              settings: {
                  memoryInGB: this.memoryInGB,
                  numberCPUs: this.numberCPUs
              }
          }
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
      computed: {
    invalidMemoryValueReason: function() {
      let value = this.settings.memoryInGB;
      // This might not work due to floating-point inaccuracies,
      // but testing showed it works for up to 3 decimal points.
      if (value === "") {
        return "No value provided";
      }
      if (!/^\d+(?:\.\d*)?$/.test(value)) {
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
      let value = this.settings.numberCPUs;
      let numericValue = parseFloat(value);
      if (isNaN(numericValue)) {
        return `${value} isnt numeric`
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
      },
      methods: {
          updatedMemory(event) {
            // this.settings.memoryInGB = event.target.value;
            try {
              if (typeof(event) === "string") {
                // TODO: Why does this happen?
                return;
              }
              this.$emit('updateMemory', event);
              event.preventDefault();
              event.stopPropagation();
            } catch(e) {
              console.log(`error in updatedMemory:${e}`)
            }
          },
          updatedCPU(event) {
            try {
              if (typeof(event) === "string") {
                // TODO: Why does this happen?
                return;
              }
              this.$emit('updateCPU', event);
              event.preventDefault();
              event.stopPropagation();
            } catch(e) {
              console.log(`error in updatedMemory:${e}`)
            }
          }
      },
  }
</script>

<template>
  <div>
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
