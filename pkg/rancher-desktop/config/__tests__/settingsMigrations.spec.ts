import _ from 'lodash';

import { updateTable } from '../settingsImpl';

import { defaultSettings, MountType, VMType } from '@pkg/config/settings';

describe('settings migrations', () => {
  describe('step 9', () => {
    const settings = _.cloneDeep(defaultSettings);

    it('should ignore noproxy list if empty', () => {
      const testSettings = _.cloneDeep(settings);

      testSettings.experimental.virtualMachine.proxy.noproxy = [];
      updateTable[9](testSettings, false);

      expect(testSettings.experimental.virtualMachine.proxy.noproxy).toStrictEqual([]);
    });

    it('should remove unnecessary blanks', () => {
      const testSettings = _.cloneDeep(settings);

      testSettings.experimental.virtualMachine.proxy.noproxy = [
        '0.0.0.0/8', ' 10.0.0.0/8', '127.0.0.0/8  ', '  169.254.0.0/16', '172.16.0.0/12',
        '192.168.0.0/16 '];
      updateTable[9](testSettings, false);

      expect(testSettings.experimental.virtualMachine.proxy.noproxy).toStrictEqual([
        '0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
        '192.168.0.0/16']);
    });

    it('should remove tabs', () => {
      const testSettings = _.cloneDeep(settings);

      testSettings.experimental.virtualMachine.proxy.noproxy = [
        '0.0.0.0/8\t', '\t10.0.0.0/8', '\t 127.0.0.0/8', '169.254.0.0/16 \t'];
      updateTable[9](testSettings, false);

      expect(testSettings.experimental.virtualMachine.proxy.noproxy).toStrictEqual([
        '0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16']);
    });

    it('should remove newlines', () => {
      const testSettings = _.cloneDeep(settings);

      testSettings.experimental.virtualMachine.proxy.noproxy = [
        '0.0.0.0/8\n', '\n10.0.0.0/8', '\n 127.0.0.0/8', '169.254.0.0/16 \n'];
      updateTable[9](testSettings, false);

      expect(testSettings.experimental.virtualMachine.proxy.noproxy).toStrictEqual([
        '0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16']);
    });

    it('should remove empty entries', () => {
      const testSettings = _.cloneDeep(settings);

      testSettings.experimental.virtualMachine.proxy.noproxy = [
        '0.0.0.0/8', '', '\n', '10.0.0.0/8', ' ', '127.0.0.0/8', '    ', '\t'];
      updateTable[9](testSettings, false);

      expect(testSettings.experimental.virtualMachine.proxy.noproxy).toStrictEqual([
        '0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8']);
    });
  });

  describe('step 10', () => {
    it('should not disable wasm in normal settings', () => {
      const testSettings = {};

      updateTable[10](testSettings, false);
      expect(testSettings).not.toHaveProperty('experimental.containerEngine.webAssembly.enabled', false);
    });

    it('should disable wasm in locked profiles', () => {
      const testSettings = {};

      updateTable[10](testSettings, true);
      expect(testSettings).toHaveProperty('experimental.containerEngine.webAssembly.enabled', false);
    });
  });

  describe('step 14', () => {
    it('should migrate experimental.virtualMachine.type (and useRosetta) to virtualMachine.*', () => {
      const testSettings = { experimental: { virtualMachine: { type: VMType.VZ, useRosetta: true } } };

      updateTable[14](testSettings, false);
      expect(testSettings).not.toHaveProperty('experimental.virtualMachine');
      expect(testSettings).toHaveProperty('virtualMachine.type', VMType.VZ);
      expect(testSettings).toHaveProperty('virtualMachine.useRosetta', true);
    });
  });

  describe('step 15', () => {
    it('should migrate experimental.virtualMachine.mount.type to virtualMachine.*', () => {
      const testSettings = { experimental: { virtualMachine: { mount: { type: MountType.REVERSE_SSHFS } } } };

      updateTable[15](testSettings, false);
      expect(testSettings).not.toHaveProperty('experimental.virtualMachine.mount.type');
      expect(testSettings).toHaveProperty('virtualMachine.mount.type', MountType.REVERSE_SSHFS);
    });
  });
});
