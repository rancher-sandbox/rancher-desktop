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
      });
    // Set target to electron so require('electron') works
    // https://github.com/electron/electron/issues/9920#issuecomment-478826728
    config.target("electron-renderer");
  },
  pluginOptions: {
    electronBuilder: {
      nodeIntegration: true,
    }
  }
}