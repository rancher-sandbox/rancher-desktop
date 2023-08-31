import { extend as veeExtend } from 'vee-validate';
import * as veeRules from 'vee-validate/dist/rules';

function extend(rule) {
  const veeRule = (veeRules || [])[rule];

  veeExtend(rule, {
    ...veeRule,
    params:  ['message'],
    message: '{message}'
  });
}

extend('required');
