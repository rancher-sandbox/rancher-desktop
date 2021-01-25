const isDevelopment = /^dev/i.test(process.env.NODE_ENV);

module.exports = {
  publicPath: !isDevelopment
  ? `${process.cwd()}/dist/`
  : '/',

  chainWebpack: config => {
    config
      .plugin('html')
      .tap(args => {
        args[0].title = "Rancher Desktop";
        return args;
      });
    if (isDevelopment) {
      config.devtool('source-map');
    }
  },
  pluginOptions: {
    electronBuilder: {
      builderOptions: {
        asar: true,
        extraResources: ["resources/"]
      },
      chainWebpackMainProcess: config => {
        // By default, the main module _isn't_ run through babel; but we need
        // that, so manually set it up.
        // https://github.com/nklayman/vue-cli-plugin-electron-builder/issues/204
        config.module
          .rule('babel')
          .test(/\.js$/)
          .exclude
          .add(/node_modules/)
          .end()
          .use('babel')
          .loader('babel-loader')
          .options({
            presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
            plugins: ['@babel/plugin-proposal-private-methods']
          });
      },
      mainProcessFile: 'background.js',
      nodeIntegration: true,
      outputDir: 'dist/electron',
    }
  }
};