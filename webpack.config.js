const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { GenerateSW } = require('workbox-webpack-plugin');
require('dotenv').config({ quiet: true });

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    entry: './src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProd ? '[name].[contenthash].js' : '[name].js',
      publicPath: '/',
      clean: true
    },
    devtool: isProd ? false : 'source-map',
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: {
      rules: [
        { test: /\.tsx?$/, loader: 'ts-loader', options: { compilerOptions: { noEmit: false } }, exclude: /node_modules/ },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ]
    },
    plugins: [
      // Only this single value is exposed to the frontend.
      new webpack.DefinePlugin({
        'process.env.DIRECT_LINE_TOKEN_ENDPOINT': JSON.stringify(process.env.DIRECT_LINE_TOKEN_ENDPOINT || ''),
        'process.env.STALE_AFTER_HIDDEN_SECONDS': JSON.stringify(process.env.STALE_AFTER_HIDDEN_SECONDS || '')
      }),
      new HtmlWebpackPlugin({ template: './public/index.html' }),
      new CopyWebpackPlugin({
        patterns: [{ from: 'public', globOptions: { ignore: ['**/index.html'] } }]
      }),
      isProd && new GenerateSW({
        clientsClaim: true,
        skipWaiting: true,
        // Precache only static build output; Direct Line, token and auth traffic is never cached.
        exclude: [/\.map$/, /^manifest\.json$/],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/(auth|oauth|signin|login|token|directline|api)(\/|$|\?)/i],
        runtimeCaching: [
          {
            // Any cross-origin request (token endpoint, Direct Line API, auth) goes straight to the network.
            urlPattern: ({ url }) => url.origin !== self.location.origin,
            handler: 'NetworkOnly'
          }
        ]
      })
    ].filter(Boolean),
    devServer: {
      port: 3000,
      hot: true,
      historyApiFallback: true,
      static: false
    },
    performance: { hints: false }
  };
};
