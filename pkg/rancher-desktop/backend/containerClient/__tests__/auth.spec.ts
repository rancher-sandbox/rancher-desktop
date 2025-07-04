/** @jest-environment node */

import {jest} from '@jest/globals';
import * as childProcess from '@pkg/utils/childProcess';
import mockModules from '@pkg/utils/testUtils/mockModules';

const modules = mockModules({
  '@pkg/utils/childProcess': {
    ...childProcess,
    spawnFile: jest.fn(childProcess.spawnFile),
  },
});

const { default: RegistryAuth } = await import('@pkg/backend/containerClient/auth');

describe('RegistryAuth', () => {
  describe('parseAuthHeader', () => {
    const testCases: {
      input: string,
      expected: { scheme: string, parameters?: Record<string, string>}[],
    }[] = [
      { input: '', expected: [] },
      {
        input:    'Basic',
        expected: [{ scheme: 'basic' }],
      },
      {
        input:    'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"',
        expected: [{ scheme: 'bearer', parameters: { realm: 'https://auth.docker.io/token', service: 'registry.docker.io' } }],
      },
      {
        input:    'one,two,three',
        expected: [{ scheme: 'one' }, { scheme: 'two' }, { scheme: 'three' }],
      },
      {
        input:    'broken quotes="value starts but never ends',
        expected: [{ scheme: 'broken', parameters: { quotes: 'value starts but never ends' } }],
      },
      {
        input:    'Token one=1,two=2, Other three="3", four="4"',
        expected: [{ scheme: 'token', parameters: { one: '1', two: '2' } }, { scheme: 'other', parameters: { three: '3', four: '4' } }],
      },
      {
        input:    'parameter=unused, token',
        expected: [{ scheme: 'token' }],
      },
      {
        input:    'token parameter=, other',
        expected: [{ scheme: 'token', parameters: { parameter: '' } }, { scheme: 'other' }],
      },
      {
        // From RFC 9110, section 11.6.1
        input:    'Basic realm="simple", Newauth realm="apps", type=1, title="Login to \\"apps\\""',
        expected: [
          { scheme: 'basic', parameters: { realm: 'simple' } },
          {
            scheme:     'newauth',
            parameters: {
              realm: 'apps', type: '1', title: 'Login to "apps"',
            },
          },
        ],
      },
    ];

    test.each(testCases)('$#: $input', ({ input, expected }) => {
      const actual = RegistryAuth['parseAuthHeader'](input);

      expect(actual).toEqual(expected.map(v => ({ parameters: {}, ...v })));
    });
  });

  describe('findAuth', () => {
    it('should not fail when failing to list known credentials', async() => {
      const exception = new Error('failed to spawn file');

      modules['@pkg/utils/childProcess'].spawnFile.mockRejectedValue(exception);
      await expect(RegistryAuth['findAuth']('example.test')).resolves.toBeUndefined();
    });
  });
});
