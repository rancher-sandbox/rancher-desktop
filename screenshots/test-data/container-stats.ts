/**
 * Mock data for container stats screenshot
 */

export const statsData = {
  CPUPerc:  '15.32%',
  MemUsage: '128.5MiB / 1.952GiB',
  NetIO:    '1.234MB / 567.8KB',
  BlockIO:  '45.6MB / 23.1MB',
  PIDs:     '12',
};

export const processTableOutput = `UID       PID    PPID   C    STIME   TTY       TIME       CMD
postgres  1      0      0    10:30   ?         00:00:05   postgres
postgres  42     1      0    10:30   ?         00:00:00   postgres: checkpointer
postgres  43     1      0    10:30   ?         00:00:00   postgres: background writer
postgres  44     1      0    10:30   ?         00:00:00   postgres: walwriter
postgres  45     1      0    10:30   ?         00:00:00   postgres: autovacuum launcher
postgres  46     1      0    10:30   ?         00:00:00   postgres: stats collector
postgres  47     1      0    10:30   ?         00:00:00   postgres: logical replication launcher
postgres  125    1      0    10:32   ?         00:00:01   postgres: webapp webapp 10.0.0.5(42532) idle
postgres  148    1      0    10:35   ?         00:00:02   postgres: webapp webapp 10.0.0.5(42874) idle in transaction
postgres  201    1      1    10:38   ?         00:00:12   postgres: webapp webapp 10.0.0.5(43201) SELECT
postgres  215    1      0    10:40   ?         00:00:01   postgres: webapp webapp 10.0.0.5(43412) idle
postgres  230    1      0    10:42   ?         00:00:00   postgres: webapp webapp 10.0.0.5(43687) idle`;

// Generate a series of stats samples that will be used to populate the charts
export function generateStatsSamples(count = 5) {
  const samples: any[] = [];
  const baseTime = new Date('2025-01-15T10:30:00');

  for (let i = 0; i < count; i++) {
    const time = new Date(baseTime.getTime() + i * 1000);
    // Vary CPU between 10-20%
    const cpuPerc = (12 + Math.sin(i * 0.5) * 5).toFixed(2);
    // Vary memory slightly around 128 MB
    const memUsed = (128 + Math.sin(i * 0.3) * 10).toFixed(1);
    // Network IO increases cumulatively
    const netRx = (1.0 + i * 0.2).toFixed(3);
    const netTx = (0.5 + i * 0.1).toFixed(3);
    // Block IO increases cumulatively
    const blockR = (45.0 + i * 0.5).toFixed(1);
    const blockW = (23.0 + i * 0.3).toFixed(1);

    samples.push({
      CPUPerc:  `${ cpuPerc }%`,
      MemUsage: `${ memUsed }MiB / 1.952GiB`,
      NetIO:    `${ netRx }MB / ${ netTx }MB`,
      BlockIO:  `${ blockR }MB / ${ blockW }MB`,
      PIDs:     String(11 + (i % 3)),
    });
  }

  return samples;
}
