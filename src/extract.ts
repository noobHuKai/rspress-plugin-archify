/**
 * archify 内嵌片段提取器 —— scripts/extract-archify-embed.py 的 TypeScript 移植。
 *
 * 输入 archify deliver 产物的自包含 HTML,输出可注入 rspress markdown 的
 * `<div class="archify-embed">` 片段(作用域化 <style> + 原样 <svg>,浅色默认、
 * html.dark 切深色,跳过 @media/@keyframes/@font-face 等查看器交互样式)。
 *
 * 约束:输出须与 python 版字节一致(selfcheck.ts 对拍回归);内嵌片段不能含
 * 空行(CommonMark HTML 块 type 7 遇空行即结束)。
 */

const SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'rect',
  'text',
  'tspan',
  'path',
  'line',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'title',
  'desc',
  'defs',
  'marker',
  'use',
  'image',
  'style',
  'a',
]);

const FONT_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, " +
  "'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK SC', " +
  "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace";

/** 按花括号配对切出顶层规则;@规则整体跳过(其嵌套体不展开)。 */
function parseTopLevelRules(css: string): Array<[string, string]> {
  const rules: Array<[string, string]> = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    const brace = css.indexOf('{', i);
    if (brace === -1) {
      break;
    }
    const selector = css.slice(i, brace).trim();
    let depth = 1;
    let j = brace + 1;
    while (j < n && depth > 0) {
      if (css[j] === '{') {
        depth += 1;
      } else if (css[j] === '}') {
        depth -= 1;
      }
      j += 1;
    }
    if (selector && !selector.startsWith('@')) {
      rules.push([
        selector.replace(/\s+/g, ' '),
        css.slice(brace + 1, j - 1).trim(),
      ]);
    }
    i = j;
  }
  return rules;
}

/** 单个复合选择器(已去伪类)是否只引用白名单内的类/ID/属性/元素。 */
function compoundOk(
  part: string,
  classes: Set<string>,
  ids: Set<string>,
  attrs: Set<string>,
  elements: Set<string>,
): boolean {
  for (let tok of part.split(/[ >+~]+/)) {
    tok = tok.trim();
    if (!tok) {
      continue;
    }
    for (const attr of tok.matchAll(/\[([a-zA-Z-]+)/g)) {
      if (!attrs.has(attr[1])) {
        return false;
      }
    }
    tok = tok.replace(/\[[^\]]*\]/g, '');
    if (!tok) {
      continue;
    }
    if (tok.startsWith('.')) {
      // 支持多类复合选择器(.card-dot.cyan):逐段都必须在白名单
      for (const cls of tok.slice(1).split('.')) {
        if (cls && !classes.has(cls)) {
          return false;
        }
      }
    } else if (tok.startsWith('#')) {
      if (!ids.has(tok.slice(1))) {
        return false;
      }
    } else if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tok)) {
      // 元素名允许数字(h1-h6 等 HTML 标题标签)
      if (!elements.has(tok.toLowerCase())) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

/** 取出声明体里全部 CSS 自定义属性。 */
function extractVars(body: string): string {
  return body
    .split(';')
    .filter((d) => d.trim().startsWith('--'))
    .map((d) => d.trim())
    .join('; ');
}

function collectClasses(block: string): Set<string> {
  const classes = new Set<string>();
  for (const m of block.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (c) {
        classes.add(c);
      }
    }
  }
  return classes;
}

const THEME_SELECTORS = new Set([
  ':root',
  'html[data-theme="dark"]',
  '[data-theme="dark"]',
  '[data-theme="light"]',
  'html',
  'body',
  '*',
]);

export function extractEmbed(html: string): string {
  const svgMatch = html.match(
    /<svg\b[^>]*data-quality-profile[^>]*>[\s\S]*?<\/svg>/,
  );
  if (!svgMatch) {
    throw new Error('archify 提取失败:未找到 data-quality-profile SVG');
  }
  const svg = svgMatch[0];

  const svgClasses = collectClasses(svg);
  const svgIds = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const svgAttrs = new Set(
    [...svg.matchAll(/\b([a-zA-Z-]+)=/g)].map((m) => m[1]),
  );

  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
    (m) => m[1],
  );
  if (styles.length === 0) {
    throw new Error('archify 提取失败:无 style 块');
  }
  // 跳过首个 @font-face 块(内嵌走系统字体栈),取主样式块
  const css = (styles.length > 1 ? styles[1] : styles[0]).replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  let lightVars = '';
  let darkVars = '';
  const kept: Array<[string, string]> = [];
  for (const [selector, body] of parseTopLevelRules(css)) {
    const parts = selector.split(',').map((p) => p.trim());
    if (
      parts.some(
        (p) =>
          p === ':root' ||
          p === 'html[data-theme="dark"]' ||
          p === '[data-theme="dark"]',
      )
    ) {
      darkVars = extractVars(body);
      continue;
    }
    if (parts.includes('[data-theme="light"]')) {
      lightVars = extractVars(body);
      continue;
    }
    if (parts.some((p) => THEME_SELECTORS.has(p))) {
      continue;
    }
    if (
      parts.every((p) =>
        compoundOk(
          p.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, ''),
          svgClasses,
          svgIds,
          svgAttrs,
          SVG_ELEMENTS,
        ),
      )
    ) {
      kept.push([parts.map((p) => `.archify-embed ${p}`).join(', '), body]);
    }
  }

  if (!lightVars || !darkVars) {
    throw new Error('archify 提取失败:未找到主题变量块');
  }

  // 纯 SVG 内嵌:SVG 之外的总结卡(cards)与 Node index 只属于交互版,
  // 静态片段不提取(用户确认内嵌图仅展示图形本身)
  const lines = [
    '<div class="archify-embed">',
    '<style>',
    `.archify-embed { font-family: ${FONT_STACK}; }`,
    `.archify-embed { ${lightVars}; }`,
    `html.dark .archify-embed { ${darkVars}; }`,
    ...kept.map(([sel, body]) => `${sel} { ${body} }`),
    '</style>',
    svg,
    '</div>',
    '',
  ];
  // markdown 的 HTML 块遇到空行即结束,必须压成无空行的单块
  return lines.join('\n').replace(/\n\s*\n/g, '\n');
}

/** 提取占位符所需的图元信息(viewBox 与标题)。 */
export function extractEmbedMeta(html: string): {
  viewBox: string;
  title: string;
} {
  const svgMatch = html.match(
    /<svg\b[^>]*data-quality-profile[^>]*>[\s\S]*?<\/svg>/,
  );
  const svg = svgMatch?.[0] ?? html;
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 1600 900';
  const title =
    svg.match(/<title id="[^"]+">([^<]+)<\/title>/)?.[1] ??
    svg.match(/<title>([^<]+)<\/title>/)?.[1] ??
    '';
  return { viewBox, title };
}
