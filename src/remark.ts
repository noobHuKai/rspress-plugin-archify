/**
 * remark 插件:识别 `:::archify` 容器指令,构建期渲染 archify 图并注入内嵌 SVG。
 *
 * md 中的写法(容器体被忽略,渲染内容完全由插件注入):
 *
 * ```md
 * :::archify src=diagrams/compose-up.workflow.json name=ipm-compose-up link
 * :::
 * ```
 *
 * 内置 remarkContainerSyntax 只转换已知 callout 类型(info/tip/...),未知类型
 * 保留原段落,本插件在其后运行并接管 `:::archify` 段落到闭合 `:::` 的整段。
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { ArchifyRuntime, DiagramTarget } from './render';
import { renderDiagram } from './render';

export interface ArchifyRemarkContext extends ArchifyRuntime {
  /** 站点 base(含尾斜杠),用于拼接交互版链接 */
  base: string;
}

export interface ArchifyProps {
  src: string;
  type?: string;
  name?: string;
  link: boolean;
}

/** archify CLI 支持的图类型(help 输出的 Types 列表) */
const DIAGRAM_TYPES = new Set([
  'architecture',
  'workflow',
  'sequence',
  'dataflow',
  'lifecycle',
]);

const TYPE_FROM_FILENAME = new RegExp(
  `^(.+)\\.(${[...DIAGRAM_TYPES].join('|')})\\.json$`,
);
const OPEN_LINE = /^\s*:::\s*archify\b[ \t]*(.*)$/;
const CLOSE_LINE = /\s*:::\s*$/;
const CLOSE_ALONE = /^\s*:::\s*$/;

/** 最小 mdast 结构(避免引入 @types/mdast 传递依赖) */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

interface MdFile {
  path?: string;
}

function textOf(node: MdNode | undefined): string {
  if (!node?.children) {
    return '';
  }
  return node.children
    .map((child) => (child.type === 'text' ? (child.value ?? '') : ''))
    .join('');
}

function parseProps(raw: string, where: string): ArchifyProps {
  const props: Record<string, string | true> = {};
  for (const token of raw.trim().split(/\s+/)) {
    if (!token) {
      continue;
    }
    const eq = token.indexOf('=');
    if (eq === 0) {
      throw new Error(
        `[plugin-archify] 非法参数 "${token}"(${where});参数格式为 key=value 或布尔 flag`,
      );
    }
    if (eq > 0) {
      let value = token.slice(eq + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      props[token.slice(0, eq)] = value;
    } else {
      props[token] = true;
    }
  }
  const src = props.src;
  if (typeof src !== 'string' || !src) {
    throw new Error(
      `[plugin-archify] :::archify 容器缺少必填参数 src(${where})`,
    );
  }
  return {
    src,
    type: typeof props.type === 'string' ? props.type : undefined,
    name: typeof props.name === 'string' ? props.name : undefined,
    link: props.link === true,
  };
}

function resolveTarget(props: ArchifyProps, where: string): DiagramTarget {
  const srcAbs = path.resolve(process.cwd(), props.src);
  if (!existsSync(srcAbs)) {
    throw new Error(`[plugin-archify] src 不存在:${srcAbs}(${where})`);
  }
  const matched = path.basename(srcAbs).match(TYPE_FROM_FILENAME);
  const type = props.type ?? matched?.[2];
  if (!type) {
    throw new Error(
      `[plugin-archify] 无法从 ${path.basename(srcAbs)} 推断图类型,请在 :::archify 参数中显式指定 type=(${where})`,
    );
  }
  if (!DIAGRAM_TYPES.has(type)) {
    throw new Error(
      `[plugin-archify] 不支持的图类型 "${type}",可用:${[...DIAGRAM_TYPES].join(' / ')}(${where})`,
    );
  }
  const name = props.name ?? matched?.[1] ?? path.basename(srcAbs, '.json');
  return { srcAbs, type, name };
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ] ?? ch,
  );
}

/**
 * 懒加载占位符:只带图元信息与回退链接,SVG 由 bridge.ts 在滚入视口时
 * fetch `<name>.embed.html` 注入,避免整棵 SVG 进 React 树与页面 chunk。
 * viewBox 的宽高比用于预留高度,减少加载后的布局跳动。
 */
function placeholder(
  base: string,
  name: string,
  title: string,
  viewBox: string,
): string {
  const parts = viewBox.trim().split(/[\s,]+/);
  const w = Number(parts[parts.length - 2] || 0);
  const h = Number(parts[parts.length - 1] || 0);
  const ratio =
    w > 0 && h > 0 ? `${Math.round(w)} / ${Math.round(h)}` : '16 / 9';
  return (
    `<div class="archify-lazy" data-embed="${base}diagrams/${name}.embed.html" style="aspect-ratio:${ratio}">` +
    `<span class="archify-lazy__label">${escapeHtml(title || name)}</span>` +
    `<span class="archify-lazy__hint">图表加载中…</span>` +
    `<a class="archify-lazy__link" href="${base}diagrams/${name}.html" target="_blank" rel="noreferrer">打开交互版</a>` +
    '</div>'
  );
}

/** 开段落是否在首行之后自带闭合 :::(无空行的单段容器) */
function selfClosed(open: MdNode): boolean {
  const joined = textOf(open);
  const firstNewline = joined.indexOf('\n');
  if (firstNewline === -1) {
    return false;
  }
  const rest = joined.slice(firstNewline + 1);
  return /(^|\n)\s*:::\s*(\n|$)/.test(rest);
}

export function remarkArchify(ctx: ArchifyRemarkContext) {
  return async (tree: MdNode, file: MdFile) => {
    const children = tree.children ?? [];
    const where = file.path ?? '(未知文件)';

    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.type !== 'paragraph') {
        continue;
      }
      const first = node.children?.[0];
      if (first?.type !== 'text' || first.value === undefined) {
        continue;
      }
      const matched = first.value.split('\n')[0].match(OPEN_LINE);
      if (!matched) {
        continue;
      }
      const props = parseProps(matched[1], where);
      const target = resolveTarget(props, where);

      let close = -1;
      if (selfClosed(node)) {
        close = i;
      } else {
        for (let j = i + 1; j < children.length; j++) {
          const candidate = children[j];
          if (candidate.type !== 'paragraph') {
            continue;
          }
          const joined = textOf(candidate);
          if (CLOSE_ALONE.test(joined) || CLOSE_LINE.test(joined)) {
            close = j;
            break;
          }
        }
      }
      if (close === -1) {
        throw new Error(`[plugin-archify] 未闭合的 :::archify 容器(${where})`);
      }

      const result = await renderDiagram(target, ctx);
      // 只注入占位符;加载后的片段自带右上角悬浮工具组(演示/全屏/交互版)
      const injected: MdNode[] = [
        {
          type: 'html',
          value: placeholder(
            ctx.base,
            target.name,
            result.title,
            result.viewBox,
          ),
        },
      ];
      children.splice(i, close - i + 1, ...injected);
    }
  };
}
