/**
 * 内嵌片段的运行时包装:右上角悬浮工具按钮组 + 作用域样式。
 * 该包装产物不进 markdown(懒加载方案),而是由 render.ts 写入
 * `<name>.embed.html` 片段文件,bridge.ts 在滚入视口时 fetch 注入。
 *
 * 工具组悬停图表时淡入(触屏常显),包含三个入口:
 *   ▶ 演示模式(打开交互查看器 ?present=1 覆盖层,见 bridge.ts)
 *   ⛶ 静态图全屏(Fullscreen API + webkit 回退)
 *   ↗ 交互版(新标签打开完整查看器)
 * 交互由 bridge.ts 做点击委托;这里的样式只负责外观。
 * :fullscreen 背景色取 archify 浅/深主题的 --bg 值(wrapper 拿不到
 * .archify-embed 上定义的变量)。
 */

export const FULLSCREEN_CSS =
  '.archify-embed-wrap{position:relative}' +
  '.archify-embed-tools{position:absolute;top:10px;right:10px;z-index:10;display:flex;gap:6px;opacity:0;transition:opacity .15s ease}' +
  '.archify-embed-wrap:hover .archify-embed-tools,.archify-embed-tools:focus-within{opacity:1}' +
  '@media (hover:none){.archify-embed-tools{opacity:.85}}' +
  '.archify-embed-tools .archify-tool{width:32px;height:32px;display:flex;align-items:center;justify-content:center;padding:0;' +
  'border:1px solid rgba(128,134,150,.35);border-radius:8px;background:rgba(128,134,150,.12);color:inherit;cursor:pointer;text-decoration:none}' +
  '.archify-embed-tools .archify-tool:hover{background:rgba(128,134,150,.25)}' +
  '.archify-embed-fullscreen .i-exit{display:none}' +
  '.archify-embed-wrap:fullscreen{display:flex;align-items:center;justify-content:center;background:#f8fafc;padding:24px}' +
  'html.dark .archify-embed-wrap:fullscreen{background:#020617}' +
  '.archify-embed-wrap:fullscreen .archify-embed{width:100%;max-width:1600px;margin:0 auto}' +
  '.archify-embed-wrap:fullscreen .archify-embed svg{width:100%;height:auto;max-height:calc(100vh - 48px)}' +
  '.archify-embed-wrap:fullscreen .archify-embed-fullscreen .i-enter{display:none}' +
  '.archify-embed-wrap:fullscreen .archify-embed-fullscreen .i-exit{display:block}';

/** 悬浮工具按钮组(演示 / 静态全屏 / 交互版)。 */
const TOOLS =
  '<div class="archify-embed-tools">' +
  '<button class="archify-present-btn archify-tool" type="button" data-viewer-url="__VIEWER__" aria-label="全屏演示(演示模式)" title="全屏演示 · 演示模式(动效与章节引导)">' +
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2h8M2 2v8" /><path d="M6 10l4 3V7l-4 3z" fill="currentColor" stroke="none"/></svg>' +
  '</button>' +
  '<button class="archify-embed-fullscreen archify-tool" type="button" aria-label="全屏查看图表" title="全屏查看 / 退出全屏">' +
  '<svg class="i-enter" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg>' +
  '<svg class="i-exit" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>' +
  '</button>' +
  '<a class="archify-open-btn archify-tool" href="__VIEWER__" target="_blank" rel="noreferrer" aria-label="在新标签打开交互版" title="在新标签打开交互版">' +
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2h5v5M14 2l-7 7M13 9.5V14H2V3h4.5"/></svg>' +
  '</a>' +
  '</div>';

/** 包一层带悬浮工具组的 wrapper(全部行非空,避免 HTML 块被空行截断)。 */
export function wrapEmbed(snippet: string, viewerUrl: string): string {
  return [
    '<div class="archify-embed-wrap">',
    snippet.trimEnd(),
    TOOLS.replaceAll('__VIEWER__', viewerUrl),
    `<style>${FULLSCREEN_CSS}</style>`,
    '</div>',
  ].join('\n');
}
