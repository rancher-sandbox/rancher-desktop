module.exports = {
  publicPath: process.env.NODE_ENV === 'production'
  ? `${process.cwd()}/dist/`
  : '/',

  chainWebpack: config => {
    config
      .plugin('html')
      .tap(args => {
        args[0].title = "Rancher Desktop";
        return args;
      })
  },
  pluginOptions: {
    electronBuilder: {
      chainWebpackMainProcess: config => {
        // By default, the main module _isn't_ run through babel; but we need
        // that, so manually set it up.
        // https://github.com/nklayman/vue-cli-plugin-electron-builder/issues/204
        config.module
          .rule('babel')
          .test(/\.js$/)
          .use('babel')
          .loader('babel-loader')
          .options({
            presets: ['@vue/cli-plugin-babel/preset'],
            plugins: ['@babel/plugin-proposal-private-methods']
          });
      },
      mainProcessFile: 'background.js',
      nodeIntegration: true,
    }
  }
}