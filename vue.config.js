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
    }
}