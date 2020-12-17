/**
 * This script is configuration for electron-forge; since we use vue-cli-service
 * for development, the easiest thing to do here is to just run that code to
 * generate the expected webpack configuration and pass it to electron-forge.
 */
'use strict';

const VueCliService = require('@vue/cli-service/lib/Service');

const service = new VueCliService(__dirname);
const mode = (process.env.NODE_ENV === 'DEV') ? 'development' : 'production';
service.init(mode);
const config = service.resolveWebpackConfig();
// Delete the output options; we need to use the defaults so electron-forge can
// find the results.
delete config.output;

// Forge wraps the config in a proxy; some of the plugin configs have `null` as
// a value, which the proxy doesn't like.  Fix them here.
for (let plugin of config.plugins) {
    switch (plugin.constructor.name) {
        case "HashedModuleIdsPlugin":
            if (plugin.options && plugin.options.context === null) {
                // The code does `options.context ? options.context : fallback`
                // so it works to set it to `false` here.
                plugin.options.context = false;
            }
            break;
    }
}

module.exports = {
    packagerConfig: {
        asar: true,
        extraResource: ["resources"],
    },
    plugins: [
        ["@electron-forge/plugin-webpack",
            {
                mainConfig: {
                    entry: "./background.js",
                    module: {
                        rules: [
                            { test: /\.js$/, use: ['cache-loader', 'babel-loader'] },
                        ]
                    }
                },
                renderer: {
                    config: config,
                    entryPoints: [{ js: "./src/main.js", name: "main_window" }]
                }
            }
        ]
    ],
    makers: [
        {
            name: "@electron-forge/maker-squirrel",
            config: { name: "rancher_desktop" }
        },
        {
            name: "@electron-forge/maker-zip",
            platforms: ["darwin"]
        }
    ],
    hooks: {
        readPackageJson: (forgeConfig, packageJson) => {
            // Override the main entrypoint, because we manually run through
            // webpack when packaging.
            packageJson.main = '.webpack/main';
            return packageJson;
        }
    }
}
