export const lockedSettings = {
  body: JSON.stringify({
    containerEngine: {
      allowedImages: {
        enabled:  true,
        patterns: true,
      },
    },
    kubernetes: { version: true },
  }),
  status:  200,
  headers: {},
};
