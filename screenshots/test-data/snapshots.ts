import dayjs from 'dayjs';

export const snapshotsList = {
  body: JSON.stringify([{
    name:    'Snapshot 1',
    created: dayjs(new Date(), 'YYYY-MM-DD_HH_mm_ss').subtract(5, 'minute'),
  }, {
    name:    'Snapshot 2',
    created: dayjs(new Date(), 'YYYY-MM-DD_HH_mm_ss'),
  }]),
  status:  200,
  headers: {},
};
