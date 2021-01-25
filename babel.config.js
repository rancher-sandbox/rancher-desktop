module.exports = {
  presets: [
    '@vue/cli-plugin-babel/preset',
  ],
  plugins: ["@babel/plugin-proposal-private-methods",
    ['module-resolver',
      {
        root: ['.'],
        alias: {
          '@': '.',
          '~': '.',
        },
      }
    ]
  ]
}
