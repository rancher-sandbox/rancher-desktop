export const volumesList = new Promise((resolve) => {
  resolve([
    {
      Name:       'desktop_penpot_postgres_v15',
      Driver:     'local',
      Mountpoint: '/var/lib/docker/volumes/desktop_penpot_postgres_v15/_data',
      CreatedAt:  '2025-01-15T10:30:00Z',
      Labels:     {
        'com.docker.compose.project': 'desktop',
        'com.docker.compose.service': 'penpot-postgres',
        'com.docker.compose.version': '2.17.3',
      },
      Scope:   'local',
      Options: null,
    },
    {
      Name:       'redis-data',
      Driver:     'local',
      Mountpoint: '/var/lib/docker/volumes/redis-data/_data',
      CreatedAt:  '2025-01-12T14:22:00Z',
      Labels:     {},
      Scope:      'local',
      Options:    null,
    },
    {
      Name:       'nginx-config',
      Driver:     'local',
      Mountpoint: '/var/lib/docker/volumes/nginx-config/_data',
      CreatedAt:  '2025-01-10T09:15:00Z',
      Labels:     {
        app:         'web-server',
        environment: 'production',
      },
      Scope:   'local',
      Options: null,
    },
    {
      Name:       'mongodb-storage',
      Driver:     'local',
      Mountpoint: '/var/lib/docker/volumes/mongodb-storage/_data',
      CreatedAt:  '2025-01-08T16:45:00Z',
      Labels:     {
        database: 'mongodb',
        version:  '7.0',
      },
      Scope:   'local',
      Options: null,
    },
    {
      Name:       'app-logs',
      Driver:     'local',
      Mountpoint: '/var/lib/docker/volumes/app-logs/_data',
      CreatedAt:  '2025-01-05T11:30:00Z',
      Labels:     {
        purpose:   'logging',
        retention: '30-days',
      },
      Scope:   'local',
      Options: null,
    },
    {
      Name:       'backup-volume',
      Driver:     'local',
      Mountpoint: '/var/lib/docker/volumes/backup-volume/_data',
      CreatedAt:  '2024-12-28T08:00:00Z',
      Labels:     {
        backup:   'daily',
        critical: 'true',
      },
      Scope:   'local',
      Options: null,
    },
  ]);
});
