// dev 用根路径;build(GitHub Pages)用子路径 /space-base-sandbox/
export default ({ command }) => ({
  base: command === 'build' ? '/space-base-sandbox/' : '/',
  server: { port: 5173, strictPort: true },
  build: { target: 'esnext' }, // 支持顶层 await
});
