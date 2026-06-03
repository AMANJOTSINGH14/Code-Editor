module.exports = {
  presets: [
    ["@babel/preset-env", { targets: { node: "current" } }],
    ["@babel/preset-react", { runtime: "automatic" }]
  ],
  plugins: [
    // Transforms `import.meta.env.*` → undefined (falls back to defaults) for Jest
    function () {
      return {
        visitor: {
          MetaProperty(path) {
            path.replaceWithSourceString('({ env: {} })');
          }
        }
      };
    }
  ]
};
