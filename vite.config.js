// dev 用根路径;build(GitHub Pages)用子路径 /space-base-sandbox/
export default ({ command }) => ({
  base: command === 'build' ? '/space-base-sandbox/' : '/',
  server: { port: 5173, strictPort: true },
  // es2019:老安卓微信 X5 内核(Chrome 77/86)不认 ??/?.(ES2020),esnext 会原样保留导致
  // 解析期 SyntaxError 整包白屏。顶层 await 已从 main.js 移除(boot() 包裹),无需 esnext。
  build: { target: 'es2019' },
});
