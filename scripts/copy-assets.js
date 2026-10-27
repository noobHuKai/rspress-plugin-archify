/* 把样式等静态资源复制到 dist(tsc 不处理非 TS 文件) */
const { copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

mkdirSync(join(__dirname, '..', 'dist'), { recursive: true });
copyFileSync(
  join(__dirname, '..', 'src', 'lazy.css'),
  join(__dirname, '..', 'dist', 'lazy.css'),
);
console.log('[copy-assets] dist/lazy.css');
