# rspress-plugin-archify

[Rspress](https://rspress.rs) 插件:把 [archify](https://github.com/tt-a1i/archify) 图表集成进文档站——构建期自动 **validate → deliver → 懒加载内嵌**,并为每张图提供静态全屏与演示模式入口。

## 特性

- **`:::archify` 容器语法**:markdown 中一行引用 archify JSON 源规格,构建期自动校验(showcase)、交付交互版 HTML、提取内嵌 SVG;
- **懒加载内嵌**:页面只注入轻量占位符(标题 + 宽高比预留 + 无 JS 回退链接),图表滚入视口时才 fetch 片段注入——整棵 SVG 不进 React 树与页面 JS chunk,首屏更轻;
- **悬浮工具组**:悬停图表右上角浮现 ▶ 演示 / ⛶ 全屏 / ↗ 交互版 三个入口;
- **演示模式**:▶ 按钮以覆盖层打开交互查看器的 presentation 模式(`?present=1`,含信号流动效与章节引导),主题、语言与直接打开完全一致;
- **交互版自动交付**:完整查看器 HTML 每次构建自动刷新到 `<docs>/public/diagrams/`,并修复 rspress public 目录复制早于 md 编译的时序竞态(afterBuild 全量同步);
- **深浅色跟随**:内嵌 SVG 使用 CSS 变量,自动跟随站点 `html.dark` 外观切换;
- **界面语言可配置**:查看器 UI 默认英文,通过 `locale: 'zh-CN'` 选项交付中文界面(经临时规格副本注入 `meta.locale`,源规格不变)。

## 前置要求

本插件在构建期调用 [archify CLI](https://github.com/tt-a1i/archify)(零依赖 Node 脚本)渲染图表。CLI 定位顺序:

1. 插件选项 `archifyBin`
2. 环境变量 `ARCHIFY_BIN`
3. `~/.agents/skills/archify/bin/archify.mjs`(通过 `npx skills add tt-a1i/archify -g` 安装)

## 安装

```bash
npm install rspress-plugin-archify
```

## 快速开始

在 `rspress.config.ts` 注册:

```ts
import { defineConfig } from 'rspress';
import { pluginArchify } from 'rspress-plugin-archify';

export default defineConfig({
  plugins: [pluginArchify({ locale: 'zh-CN' })],
});
```

在 markdown 中引用图表(规格路径相对项目根):

```md
:::archify src=diagrams/deploy.workflow.json
:::
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `src` | 是 | archify JSON 源规格路径 |
| `type` | 否 | 图类型,默认从文件名 `<名称>.<类型>.json` 推断(architecture / workflow / sequence / dataflow / lifecycle) |
| `name` | 否 | 交互版 HTML 基名,默认取文件名中的名称段 |

## 插件选项

```ts
interface ArchifyPluginOptions {
  /** archify CLI 入口(默认 ~/.agents/skills/archify/bin/archify.mjs) */
  archifyBin?: string;
  /** 交互版 HTML 输出目录(默认 <docs root>/public/diagrams) */
  publicDiagramsDir?: string;
  /** 查看器界面语言(如 'zh-CN');未设置交付规格原样(默认英文) */
  locale?: string;
  /** 严格模式:渲染失败直接终止构建。默认生产构建严格、dev 回退旧产物并警告 */
  strict?: boolean;
}
```

## 工作原理

```
:::archify 容器
   │ 构建期(remark 插件)
   ├─ archify validate <type> <spec> --quality showcase   # 非零退出不算成功
   ├─ archify deliver  <type> <spec> <public/diagrams>/<name>.html
   ├─ 提取内嵌 SVG + 作用域化样式 → <name>.embed.html 片段
   └─ 注入轻量占位符(.archify-lazy)
        │ 运行时(全局桥接组件)
        ├─ 滚入视口 → fetch 片段 → outerHTML 注入
        ├─ 悬停工具组:▶ 演示(present 覆盖层)/ ⛶ 全屏 / ↗ 交互版
        └─ scroll/resize + 轮询兜底(兼容 IM 内嵌 webview)
```

展示分层:静态内嵌为纯 SVG(不含查看器的总结卡与 Node index);完整内容(卡片、节点索引、搜索、路由探查、导出等)在交互版;演示模式为 present=1 的查看器(不含 Node index)。

## 已知行为

- 修改 JSON 源后,dev 模式需 touch 对应 md 触发重编译(生产构建不受影响);
- llms 输出走独立管线,不包含注入的图表(对 LLM 消费者通常更干净);
- 生产构建失败(校验不过、CLI 缺失)会终止构建;dev 模式在存在旧交付产物时回退并警告。

## 开发

```bash
pnpm install
pnpm build   # tsc → dist + 复制 lazy.css
```

目录结构:`src/index.ts` 插件工厂、`src/remark.ts` 容器解析与占位符注入、`src/render.ts` CLI 编排/缓存/交付后处理、`src/extract.ts` SVG 提取器、`src/wrapper.ts` 工具组包装、`src/bridge.ts` 运行时桥接、`src/lazy.css` 占位符样式。

本插件已在 [InsightOS Package Manager 文档站](https://git.insightos.cn/kernel/package-manager/ipm)生产使用。

## License

MIT
