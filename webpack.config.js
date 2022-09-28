const path = require('path');

module.exports = {
  entry: './dist/index.js',
  resolve: {
      fallback: {
        "buffer": false, 
      },
  },
  output: {
    libraryTarget: "var",
    library: "solidClient",
    filename: 'solid-client-bundle.js',
    path: path.resolve(__dirname, 'dist2'),
  },
};
