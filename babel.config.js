module.exports = {
  presets: [
    '@vue/cli-plugin-babel/preset'
  ],
  plugins: ["@babel/plugin-proposal-private-methods",
    ["babel-plugin-root-import", { "rootPathSuffix": "./", "rootPathPrefix": "@/"}],
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
