/**
 * pluginArchify —— archify 图表构建期集成插件。
 *
 * 文档中用 `:::archify src=<json 路径> [name=...] [type=...] [link]` 容器引用
 * archify JSON 源规格;构建时插件执行 validate → deliver(交互版 HTML 自动
 * 刷新到 docs/public/diagrams/)→ 提取内嵌 SVG 注入页面。
 *
 * archify CLI 定位顺序:插件选项 archifyBin > 环境变量 ARCHIFY_BIN >
 * ~/.agents/skills/archify/bin/archify.mjs。
 */

import * as os from 'node:os';
import * as path from 'node:path';
import type { RspressPlugin } from '@rspress/core';
import type { ArchifyRemarkContext } from './remark';
import { remarkArchify } from './remark';
import { syncDiagramsToOutDir } from './render';

// 独立导出提取工具,便于使用方做提取回归/自定义消费
export { extractEmbed, extractEmbedMeta } from './extract';

export interface ArchifyPluginOptions {
  /** archify CLI 入口(默认 ~/.agents/skills/archify/bin/archify.mjs) */
  archifyBin?: string;
  /** 交互版 HTML 输出目录(默认 <docs root>/public/diagrams) */
  publicDiagramsDir?: string;
  /**
   * 查看器界面语言(如 'zh-CN');未设置时交付规格原样(默认英文)。
   * 构建期注入临时规格副本的 meta.locale,源规格文件不变。
   */
  locale?: string;
  /** 严格模式:任何渲染失败直接终止。默认生产构建严格、dev 降级回退旧产物 */
  strict?: boolean;
}

export function pluginArchify(
  options: ArchifyPluginOptions = {},
): RspressPlugin {
  const ctx: ArchifyRemarkContext = {
    archifyBin:
      options.archifyBin ??
      process.env.ARCHIFY_BIN ??
      path.join(
        os.homedir(),
        '.agents',
        'skills',
        'archify',
        'bin',
        'archify.mjs',
      ),
    publicDiagramsDir: '',
    base: '/',
    locale: options.locale,
    strict: false,
  };

  return {
    name: 'plugin-archify',
    config(config, _utils, isProd) {
      ctx.publicDiagramsDir =
        options.publicDiagramsDir ??
        path.join(config.root ?? 'docs', 'public', 'diagrams');
      ctx.base = config.base ?? '/';
      if (!ctx.base.endsWith('/')) {
        ctx.base += '/';
      }
      ctx.strict = options.strict ?? isProd;
      return config;
    },
    markdown: {
      remarkPlugins: [[remarkArchify, ctx]],
    },
    // 全屏按钮 + 懒加载占位符的全局桥接组件(渲染为 null,仅注册监听)
    globalUIComponents: [path.join(__dirname, 'bridge.js')],
    // 懒加载占位符样式(全站一份,构建时由 scripts/copy-assets.js 复制到 dist)
    globalStyles: path.join(__dirname, 'lazy.css'),
    afterBuild(config, isProd) {
      if (!isProd) {
        return;
      }
      // rspress 复制 public/ 先于 md 编译,构建期更新的图表产物滞后一轮;
      // 构建收尾全量同步,保证 outDir 与源一致
      const outDir = path.resolve(process.cwd(), config.outDir ?? 'doc_build');
      const copied = syncDiagramsToOutDir(ctx.publicDiagramsDir, outDir);
      console.log(
        `[plugin-archify] 已同步 ${copied.length} 个图表产物到 ${outDir}/diagrams`,
      );
    },
  };
}

export default pluginArchify;
