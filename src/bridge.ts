/**
 * 全局桥接组件(经 globalUIComponents 挂载,全站单例),承担三件事:
 *
 * 1. 懒加载:remark 只注入轻量占位符(.archify-lazy,带 data-embed 片段
 *    URL),占位符滚入视口(含 200px 预取边距)时 fetch 片段并 outerHTML
 *    注入,整棵 SVG 不进 React 树与页面 chunk。可见性检测用 scroll/resize
 *    + 轮询兜底的几何判断而非 IntersectionObserver——部分内嵌 webview
 *    (如 IM 内置浏览器)的 IO 从不回调。MutationObserver 兼容 SPA 路由
 *    切换后新出现的占位符。
 * 2. 静态图全屏:点击委托接管 `.archify-embed-fullscreen` 按钮,对最近的
 *    `.archify-embed-wrap` 切换全屏(Fullscreen API + webkit 回退)。
 * 3. 演示模式:点击 `.archify-present-btn` 打开交互查看器演示模式覆盖层
 *    (iframe 加载 <name>.html?present=1,与直接打开该链接完全一致,主题由
 *    viewer 自行决定),优先原生全屏、被拒时覆盖层自身 fixed 全屏;
 *    ✕ / Esc / 点空白关闭。
 */

import { useEffect } from 'react';

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const PREFETCH_MARGIN = 200;

export default function ArchifyBridge(): null {
  useEffect(() => {
    const loadEmbed = async (el: HTMLElement): Promise<void> => {
      const url = el.dataset.embed;
      if (!url) {
        return;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const html = await res.text();
        el.outerHTML = html;
      } catch {
        el.classList.add('archify-lazy--error');
        const hint = el.querySelector('.archify-lazy__hint');
        if (hint) {
          hint.textContent = '图表加载失败,请用下方链接打开交互版';
        }
      }
    };

    const pending = new Set<HTMLElement>();
    let pollTimer = 0;

    const inView = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const viewport =
        window.innerHeight || document.documentElement.clientHeight;
      return (
        rect.bottom > -PREFETCH_MARGIN && rect.top < viewport + PREFETCH_MARGIN
      );
    };

    // 扫描 pending 中进入视口的占位符并加载。加载会改变后续占位符位置,
    // pending 清空后停表;SPA 路由离开时移除已脱离文档的节点。
    const sweep = (): void => {
      for (const el of [...pending]) {
        if (!el.isConnected) {
          pending.delete(el);
          continue;
        }
        if (inView(el)) {
          pending.delete(el);
          void loadEmbed(el);
        }
      }
      if (pending.size === 0) {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = 0;
        }
        return;
      }
      // 部分内嵌 webview 不派发原生 scroll 事件、IntersectionObserver 与
      // rAF 回调也被挂起,轮询是唯一在所有环境都可靠的触发方式。
      if (!pollTimer) {
        pollTimer = window.setInterval(sweep, 300);
      }
    };

    const register = (root: Element | Document): void => {
      root
        .querySelectorAll?.('.archify-lazy:not([data-archify-watch])')
        .forEach((el) => {
          const node = el as HTMLElement;
          node.setAttribute('data-archify-watch', '1');
          pending.add(node);
        });
      const self = root as Element;
      if (self.matches?.('.archify-lazy:not([data-archify-watch])')) {
        self.setAttribute('data-archify-watch', '1');
        pending.add(self as HTMLElement);
      }
      sweep();
    };

    register(document);

    const mo = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            register(node as Element);
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('scroll', sweep, { passive: true });
    window.addEventListener('resize', sweep, { passive: true });

    // ---- 演示模式覆盖层(「⛶ 全屏演示」按钮) ----
    let presentationOverlay: HTMLElement | null = null;

    const closePresentation = (): void => {
      const overlay = presentationOverlay;
      if (!overlay) {
        return;
      }
      presentationOverlay = null;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      overlay.remove();
    };

    const openPresentation = (button: HTMLElement): void => {
      const url = button.dataset.viewerUrl;
      if (!url) {
        return;
      }
      closePresentation();
      // 不强制 theme 参数:与直接打开 ?present=1 完全一致,viewer 按自身
      // localStorage(iframe 同源共享)与系统偏好决定深浅色
      // (Node index 已在交付产物中统一隐藏,见 render.ts)
      const sep = url.includes('?') ? '&' : '?';

      const overlay = document.createElement('div');
      overlay.className = 'archify-viewer-overlay';
      const iframe = document.createElement('iframe');
      iframe.src = `${url}${sep}present=1`;
      iframe.title = 'archify 图表演示';
      iframe.allowFullscreen = true;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'archify-viewer-close';
      close.setAttribute('aria-label', '关闭演示');
      close.textContent = '✕';
      close.addEventListener('click', closePresentation);
      overlay.append(iframe, close);
      // 点 iframe 外的空白区域同样可关闭
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          closePresentation();
        }
      });
      document.body.appendChild(overlay);
      presentationOverlay = overlay;

      // 原生全屏;被 webview 拒绝时覆盖层自身即 fixed 全屏,效果等价
      const requestable = overlay as FullscreenElement;
      if (typeof requestable.requestFullscreen === 'function') {
        requestable.requestFullscreen().catch(() => {});
      } else {
        requestable.webkitRequestFullscreen?.();
      }
    };

    const onFullscreenChange = (): void => {
      if (!document.fullscreenElement && presentationOverlay) {
        presentationOverlay.remove();
        presentationOverlay = null;
      }
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closePresentation();
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeydown);

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const present = target?.closest('.archify-present-btn');
      if (present) {
        openPresentation(present as HTMLElement);
        return;
      }
      const button = target?.closest('.archify-embed-fullscreen');
      if (!button) {
        return;
      }
      const wrap = button.closest(
        '.archify-embed-wrap',
      ) as FullscreenElement | null;
      if (!wrap) {
        return;
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
      }
      if (typeof wrap.requestFullscreen === 'function') {
        wrap.requestFullscreen().catch(() => {});
      } else {
        wrap.webkitRequestFullscreen?.();
      }
    };
    document.addEventListener('click', onClick);

    return () => {
      closePresentation();
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      mo.disconnect();
      window.removeEventListener('scroll', sweep);
      window.removeEventListener('resize', sweep);
      document.removeEventListener('click', onClick);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeydown);
    };
  }, []);
  return null;
}
