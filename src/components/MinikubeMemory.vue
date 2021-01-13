<script>
  import LabeledInput from '@/src/components/form/LabeledInput.vue'
  export default {
    components: {
      LabeledInput
    },
    props: {
      memory_in_gb: {
        type: String,
        default: "1"
      }
    },
    // emits: ['input']
  }
</script>

<template>
  <div>
    <LabeledInput
      :value="memory_in_gb"
      label="memory in GB"
      />
  </div>
</template>
