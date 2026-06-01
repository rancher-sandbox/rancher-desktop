import type { ContainerInspectData } from '@pkg/store/container-engine';

/**
 * Mock inspect data for the first container in containersList
 * (postgres:15 with ID b253b86ddaca...)
 */
export const containerInspectData: ContainerInspectData = {
  Id:      'b253b86ddaca501c0f542564d086b7535ed015faa323f0f8df8fccc38c0c8ee0',
  Name:    '/webapp-postgres-1',
  Created: '2025-01-15T08:08:30.123456789Z',
  State:   {
    Status:     'running',
    StartedAt:  '2025-01-15T08:08:30.987654321Z',
    FinishedAt: '0001-01-01T00:00:00Z',
  },
  Config: {
    Image: 'postgres:15',
    Env:   [
      'POSTGRES_USER=webapp',
      'POSTGRES_PASSWORD=webapp',
      'POSTGRES_DB=webapp',
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/postgresql/15/bin',
      'GOSU_VERSION=1.17',
      'LANG=en_US.utf8',
      'PG_MAJOR=15',
      'PG_VERSION=15.5-1.pgdg120+1',
      'PGDATA=/var/lib/postgresql/data',
    ],
    Cmd:        ['postgres'],
    Entrypoint: ['docker-entrypoint.sh'],
    Labels:     {
      'com.docker.compose.config-hash':          '6bc84b873e5a54c963a2a5beb0468a9c0739073acccf25087690737d7d620b65',
      'com.docker.compose.container-number':     '1',
      'com.docker.compose.depends_on':           '',
      'com.docker.compose.image':                'sha256:7317fa7ddf4f0870b999784a8ff3f5d8f180fa43e0b894394cc3d8f3aa6cdbd9',
      'com.docker.compose.oneoff':               'False',
      'com.docker.compose.project':              'web-compose',
      'com.docker.compose.project.config_files': '/Users/USER/Desktop/docker-compose.yaml',
      'com.docker.compose.project.working_dir':  '/Users/USER/Desktop',
      'com.docker.compose.service':              'webapp-postgres',
      'com.docker.compose.version':              '2.17.3',
    },
  },
  HostConfig: {
    CapAdd:  ['SYS_ADMIN', 'NET_ADMIN'],
    CapDrop: ['MKNOD', 'SYS_CHROOT'],
  },
  Mounts: [
    {
      Type:        'volume',
      Source:      '/var/lib/docker/volumes/webapp_postgres_v15/_data',
      Destination: '/var/lib/postgresql/data',
      RW:          true,
      Mode:        'z',
    },
  ],
  NetworkSettings: {
    IPAddress: '172.18.0.3',
    Ports:     {
      '5432/tcp': null,
    },
    Networks: {
      webapp_network: {
        IPAddress: '172.18.0.3',
      },
    },
  },
  Args: [],
};
