<script>
  import LabeledInput from '@/src/components/form/LabeledInput.vue'
  export default {
    components: {
      LabeledInput
    },
/*
      data() {
          return {
              settings: {
                  memoryInGB: this.memoryInGB,
                  numberCPUs: this.numberCPUs
              }
          }
      },
*/
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
            //this.settings.memoryInGB = event.target.value;
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
    computed: {

      invalidMemoryValueReason: function() {
        console.log(`QQQ: >>> minikube invalidMemoryValueReason`);
        let value = this.memoryInGB;
        // This might not work due to floating-point inaccuracies,
        // but testing showed it works for up to 3 decimal points.
        if (value === "") {
          console.log(`QQQ: <<< false`);
          return "No value provided";
        }
        if (!/^-?\d+(?:\.\d*)?$/.test(value)) {
          console.log(`QQQ: <<< false`);
          return "Contains non-numeric characters";
        }
        let numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
          console.log(`QQQ: <<< false`);
          return `${value} isnt numeric`
        }
        if (numericValue < 2) {
          console.log(`QQQ: <<< false`);
          return "Specified value is too low, must be at least 2 (GB)";
        }
        if (numericValue > this.availMemoryInGB && this.availMemoryInGB) {
          let etre = this.availMemoryInGB == 1 ? "is" : "are";
          console.log(`QQQ: <<< false`);
          return `Specified value is too high, only ${this.availMemoryInGB} GB ${etre} available`;
        }
        console.log(`QQQ: <<< true`);
        return '';
      },

      memoryValueIsValid: function() {
        console.log(`QQQ: >>> minikube memoryValueIsValid`);
        console.log(`QQQ: <<< ${!this.invalidMemoryValueReason}`);
        return !this.invalidMemoryValueReason;
      },
      memoryValueIsntValid: function() {
        console.log(`QQQ: >>> minikube memoryValueIsntValid`);
        console.log(`QQQ: <<< ${!this.memoryValueIsntValid}`);
        return !this.memoryValueIsValid;
      },
      invalidNumCPUsValueReason: function() {
        console.log(`QQQ: >>> minikube invalidNumCPUsValueReason`);
        let value = this.numberCPUs;
        let numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
          console.log(`QQQ: <<< false`);
          return `${value} isnt numeric`
        }
        if (numericValue < 2) {
          console.log(`QQQ: <<< false`);
          return "Specified value is too low, must be at least 2 (GB)";
        }
        if (numericValue > this.availNumCPUs && this.availNumCPUs) {
          console.log(`QQQ: <<< false`);
          const pluralSuffix = this.availNumCPUs == 1 ? "" : "s";
          const isVerb = this.availNumCPUs == 1 ? "is" : "are";
          return `Specified value is too high, only ${this.availNumCPUs} CPU${pluralSuffix} ${isVerb} available`;
        }
        console.log(`QQQ: <<< true`);
        return '';
      },

      numCPUsValueIsValid: function() {
        console.log(`QQQ: >>> minikube numCPUsValueIsValid`);
        console.log(`QQQ: <<< ${!this.invalidNumCPUsValueReason}`);
        return !this.invalidNumCPUsValueReason;
      },
      numCPUsValueIsntValid: function() {
        console.log(`QQQ: >>> minikube numCPUsValueIsntValid`);
        console.log(`QQQ: <<< ${!this.numCPUsValueIsValid}`);
        return !this.numCPUsValueIsValid;
      },
    }
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
