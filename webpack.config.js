const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules\/(?!(better-gdrive)\/)/, // Обрабатываем better-gdrive
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                targets: "> 0.25%, not dead",
                modules: 'commonjs'
              }]
            ],
            plugins: ['@babel/plugin-transform-modules-commonjs']
          }
        }
      }
    ]
  },
  // Добавляем игнорирование ошибок для модулей, которые не нужны в браузере
  resolve: {
    fallback: {
      "fs": false,
      "path": false,
      "crypto": false,
      "stream": false,
      "http": false,
      "https": false,
      "url": false,
      "zlib": false,
      "os": false,
      "util": false,
      "assert": false,
      "buffer": false,
      "process": false
    }
  }
};