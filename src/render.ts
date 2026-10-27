/**
 * archify 渲染编排:validate → deliver → 提取内嵌片段。
 *
 * 遵循 archify 原则:非零退出不算成功。生产构建(strict)校验/交付失败即抛错;
 * dev(非 strict)在有旧交付产物时回退并给出醒目警告。结果按 JSON 规格
 * 内容哈希做进程内缓存,同一次构建/多个页面引用同一图只渲染一次。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractEmbed, extractEmbedMeta } from './extract';
import { wrapEmbed } from './wrapper';

export interface ArchifyRuntime {
  /** archify CLI 入口(mjs 脚本绝对路径) */
  archifyBin: string;
  /** 交互版 HTML 输出目录(docs/public/diagrams) */
  publicDiagramsDir: string;
  /** 站点 base(含尾斜杠),用于片段内交互版链接 */
  base: string;
  /**
   * 交付的查看器界面语言(如 'zh-CN');未设置时用规格原样(默认英文)。
   * CLI 无 locale 参数,通过临时规格副本注入 meta.locale 实现。
   */
  locale?: string;
  /** true = 任何失败直接抛错;false = 有旧产物时回退降级 */
  strict: boolean;
}

export interface DiagramTarget {
  /** archify JSON 源规格绝对路径 */
  srcAbs: string;
  /** 图类型(architecture / workflow / sequence / dataflow / lifecycle) */
  type: string;
  /** 交互版 HTML 基名(不含扩展名) */
  name: string;
}

export interface DiagramResult {
  htmlPath: string;
  /** 懒加载片段文件路径(<name>.embed.html),页面滚入视口时 fetch 注入 */
  embedFragmentPath: string;
  snippet: string;
  /** 占位符元信息 */
  viewBox: string;
  title: string;
}

const cache = new Map<string, { hash: string; result: DiagramResult }>();

function warn(message: string): void {
  console.warn(`[plugin-archify] ${message}`);
}

function runNode(
  bin: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`archify CLI 超时:${bin} ${args.join(' ')}`));
    }, 120_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** 展示 CLI 失败输出的关键信息(receipt 是 JSON 时取 error/诊断,否则截前 12 行)。 */
function receiptSummary(stdout: string): string {
  try {
    const receipt = JSON.parse(stdout) as {
      error?: string;
      diagnostics?: Array<{ message?: string }>;
    };
    const parts = [
      receipt.error,
      ...(receipt.diagnostics ?? []).map((d) => d.message),
    ].filter((s): s is string => Boolean(s));
    if (parts.length > 0) {
      return parts.slice(0, 4).join('\n');
    }
  } catch {
    // 非 JSON 输出,走截断兜底
  }
  return stdout.split('\n').slice(0, 12).join('\n');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 跨进程目录锁:archify 3.2 的 deliver 用目录级单锁
 * (<diagrams>/.archify-delivery-lock.json)互斥,任何两张图并行交付都会
 * 以 delivery/concurrent-attempt 失败——rspress 的 node/web 编译器并行
 * 编译 md 时必然发生。用 mkdir 的原子性把同一输出目录的整段 CLI 调用
 * 串行化(粒度=目录,与 archify 锁模型一致)。持锁进程崩溃会留下锁目录,
 * 等待超时后强制接管(交付确定性输出,重跑安全)。
 */
async function withDiagramsLock<T>(
  publicDiagramsDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = createHash('sha1')
    .update(publicDiagramsDir)
    .digest('hex')
    .slice(0, 12);
  const lockDir = path.join(os.tmpdir(), `rspress-plugin-archify-lock-${key}`);
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      if (Date.now() > deadline) {
        // 疑似残留锁:接管
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      await sleep(200);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/**
 * 带单次重试的 CLI 调用:交付是确定性的,残余的并发冲突重试即可恢复;
 * 真实失败重试后依旧失败,按原样上报。
 */
async function runNodeRetry(
  bin: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  let result = await runNode(bin, args);
  if (result.code !== 0) {
    await sleep(300);
    result = await runNode(bin, args);
  }
  return result;
}

/**
 * 站点定制:交付产物注入"演示模式(present=1)下隐藏 reader-rail /
 * Node index"的样式。直接打开交互图保持原版(Node index 可见);全屏
 * 演示覆盖层以 present=1 打开,不展示索引栏——与 viewer 在演示模式下
 * 隐藏总结卡的行为一致。幂等:已注入则跳过。
 */
const NO_NODE_INDEX_IN_PRESENT_STYLE =
  '<style id="archify-site-norail">' +
  'html[data-present="true"] .node-outline{display:none!important}' +
  'html[data-present="true"][data-reader-rail] .reader-rail{display:none!important}' +
  'html[data-present="true"][data-reader-rail="true"] .container{grid-template-columns:minmax(0,1fr)!important}' +
  '</style>';

function injectNorailGuard(htmlPath: string): void {
  const html = readFileSync(htmlPath, 'utf8');
  if (html.includes('archify-site-norail')) {
    return;
  }
  const headEnd = html.indexOf('</head>');
  if (headEnd === -1) {
    return;
  }
  writeFileSync(
    htmlPath,
    html.slice(0, headEnd) +
      NO_NODE_INDEX_IN_PRESENT_STYLE +
      html.slice(headEnd),
  );
}

/**
 * 计算实际交给 CLI 的规格路径:配置了 locale 且与规格当前值不同时,
 * 写临时副本注入 meta.locale。临时目录用 os.tmpdir()——不能放
 * node_modules/.cache,rsbuild 构建初期会清整该目录,导致并发中的
 * deliver 在 prepare 阶段读不到输入。
 */
function effectiveSpecPath(
  target: DiagramTarget,
  rt: ArchifyRuntime,
  specText: string,
): string {
  if (!rt.locale) {
    return target.srcAbs;
  }
  const spec = JSON.parse(specText) as { meta?: Record<string, unknown> };
  if (spec.meta?.locale === rt.locale) {
    return target.srcAbs;
  }
  spec.meta = { ...spec.meta, locale: rt.locale };
  const tmpDir = path.join(os.tmpdir(), 'rspress-plugin-archify');
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${target.name}.${target.type}.json`);
  writeFileSync(tmpPath, JSON.stringify(spec, null, 2));
  return tmpPath;
}

/**
 * 并发防护:node/web 两个编译器会并行编译 md,同一张图可能同时触发
 * validate/deliver——archify 原子交付的同目录快照会相互冲突(prepare 阶段
 * 失败)。进行中 Promise 复用消除本进程并发;交付是确定性的,跨进程冲突
 * 由 runNodeRetry 的单次重试兜底。
 */
const inflight = new Map<string, Promise<DiagramResult>>();

export function renderDiagram(
  target: DiagramTarget,
  rt: ArchifyRuntime,
): Promise<DiagramResult> {
  const pending = inflight.get(target.srcAbs);
  if (pending) {
    return pending;
  }
  const run = renderDiagramOnce(target, rt).finally(() => {
    inflight.delete(target.srcAbs);
  });
  inflight.set(target.srcAbs, run);
  return run;
}

async function renderDiagramOnce(
  target: DiagramTarget,
  rt: ArchifyRuntime,
): Promise<DiagramResult> {
  const spec = readFileSync(target.srcAbs, 'utf8');
  const hash = createHash('sha256')
    .update(spec)
    .update(`\nlocale:${rt.locale ?? ''}`)
    .digest('hex');
  const hit = cache.get(target.srcAbs);
  if (hit && hit.hash === hash) {
    return hit.result;
  }

  const htmlPath = path.join(rt.publicDiagramsDir, `${target.name}.html`);
  const embedFragmentPath = path.join(
    rt.publicDiagramsDir,
    `${target.name}.embed.html`,
  );

  const buildResult = (): DiagramResult => {
    injectNorailGuard(htmlPath);
    const html = readFileSync(htmlPath, 'utf8');
    const { viewBox, title } = extractEmbedMeta(html);
    const snippet = extractEmbed(html);
    // 懒加载片段:页面占位符滚入视口时由 bridge.ts fetch 注入
    writeFileSync(
      embedFragmentPath,
      wrapEmbed(snippet, `${rt.base}diagrams/${target.name}.html`),
    );
    return { htmlPath, embedFragmentPath, snippet, viewBox, title };
  };

  const staleOrThrow = (reason: string): DiagramResult => {
    if (!existsSync(htmlPath)) {
      throw new Error(`${reason},且不存在已交付的 ${htmlPath} 可回退`);
    }
    if (rt.strict) {
      throw new Error(`${reason}(生产构建不允许回退旧交付产物)`);
    }
    warn(`${reason};回退使用已交付产物 ${htmlPath}(内容可能过期)`);
    return buildResult();
  };

  if (!existsSync(rt.archifyBin)) {
    return staleOrThrow(`archify CLI 不存在:${rt.archifyBin}`);
  }
  mkdirSync(rt.publicDiagramsDir, { recursive: true });

  const cliSpec = effectiveSpecPath(target, rt, spec);
  await withDiagramsLock(rt.publicDiagramsDir, async () => {
    const validate = await runNodeRetry(rt.archifyBin, [
      'validate',
      target.type,
      cliSpec,
      '--quality',
      'showcase',
      '--json',
    ]);
    if (validate.code !== 0) {
      throw new Error(
        `archify validate 失败(exit ${validate.code},${target.srcAbs}):
${receiptSummary(validate.stdout || validate.stderr)}`,
      );
    }

    const deliver = await runNodeRetry(rt.archifyBin, [
      'deliver',
      target.type,
      cliSpec,
      htmlPath,
      '--quality',
      'showcase',
      '--json',
    ]);
    if (deliver.code !== 0) {
      throw new Error(
        `archify deliver 失败(exit ${deliver.code},${target.srcAbs} → ${htmlPath}):
${receiptSummary(deliver.stdout || deliver.stderr)}`,
      );
    }
  });

  const result = buildResult();
  cache.set(target.srcAbs, { hash, result });
  return result;
}

/**
 * 构建收尾同步:rspress 在 md 编译前就把 public/ 复制进 outDir,构建期
 * 重新交付/写入的图表产物在 outDir 里会滞后一轮(首次干净构建则缺失)。
 * afterBuild 阶段把源 public/diagrams/ 全量覆盖到 outDir,消除时序竞态。
 */
export function syncDiagramsToOutDir(
  publicDiagramsDir: string,
  outDir: string,
): string[] {
  if (!existsSync(publicDiagramsDir)) {
    return [];
  }
  const dest = path.join(outDir, 'diagrams');
  mkdirSync(dest, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(publicDiagramsDir)) {
    const srcFile = path.join(publicDiagramsDir, entry);
    if (!statSync(srcFile).isFile()) {
      continue;
    }
    copyFileSync(srcFile, path.join(dest, entry));
    copied.push(entry);
  }
  return copied;
}
