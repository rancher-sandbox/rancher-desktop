/**
 * @jest-environment-options {"url": "app://index.html"}
 */

import { jest } from '@jest/globals';

import mockModules from '@pkg/utils/testUtils/mockModules';

mockModules({
  electron:                 undefined,
  '@pkg/utils/ipcRenderer': {
    ipcRenderer: { on: jest.fn(), send: jest.fn(), invoke: jest.fn() },
  },
});

const { RDXClient } = await import('../extensions');

describe('RDXClient', () => {
  describe('docker.listContainers', () => {
    it('restores the leading slash that the Docker Engine API puts on container names', async() => {
      const client = new RDXClient();
      const lsResult = {
        code:           0,
        parseJsonLines: () => [{
          ID:        'abcdef123456',
          Names:     'web', // The CLI strips the leading slash that the Engine API includes.
          Image:     'nginx',
          Command:   '"nginx -g daemon off;"',
          Status:    'Up 5 minutes',
          CreatedAt: '2024-01-01T00:00:00Z',
        }],
      };
      const inspectResult = {
        code:           0,
        parseJsonLines: () => [{
          Id:              'abcdef1234567890',
          Name:            '/web',
          Image:           'nginx',
          ImageID:         'sha256:deadbeef',
          NetworkSettings: { Ports: {} },
          Mounts:          [],
          HostConfig:      {},
          SizeRootFs:      0,
          SizeRw:          0,
          Config:          { Labels: {} },
          State:           { Status: 'running', State: 'running', StartedAt: '2024-01-01T00:00:00Z' },
        }],
      };

      client.docker.cli.exec = jest.fn()
        .mockResolvedValueOnce(lsResult)
        .mockResolvedValueOnce(inspectResult) as any;

      const [container] = await client.docker.listContainers();

      expect(container.Names).toEqual(['/web']);
    });
  });
});
