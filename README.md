# rspress-plugin-archify

[![npm version](https://img.shields.io/npm/v/rspress-plugin-archify)](https://www.npmjs.com/package/rspress-plugin-archify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**English** | [简体中文](./README.zh-CN.md)

An [Rspress](https://rspress.rs) plugin that integrates [archify](https://github.com/tt-a1i/archify) diagrams into your documentation site. At build time, each diagram is validated and delivered automatically; on the page, a lightweight placeholder lazy-loads a static SVG embed, with one-click fullscreen and presentation-mode entry points for the interactive viewer.

## Features

- **`:::archify` container syntax** — reference an archify JSON spec in one line of Markdown. The plugin validates it at build time (`showcase` quality), delivers the interactive viewer HTML, and extracts a static SVG for in-page embedding.
- **Lazy-loaded embeds** — pages only get a tiny placeholder (title + aspect-ratio reservation + no-JS fallback link). The SVG fragment is fetched and injected when the diagram scrolls into view, so the full SVG tree never enters the React tree or the page's JS chunk.
- **Hover toolbar** — hovering a diagram reveals three actions in the top-right corner: ▶ present, ⛶ fullscreen, and ↗ open interactive version.
- **Presentation mode** — the ▶ button opens the interactive viewer's presentation mode (`?present=1`, with signal-flow animation and section-by-section guidance) in an overlay, using the same theme and language as the standalone viewer.
- **Automatic delivery** — the full viewer HTML is refreshed into `<docs>/public/diagrams/` on every build. An `afterBuild` sync step also fixes a race where Rspress copies the `public/` directory before Markdown compilation finishes.
- **Dark mode aware** — embedded SVGs use CSS variables and follow your site's `html.dark` appearance toggle.
- **Configurable UI language** — the viewer UI defaults to English; pass `locale: 'zh-CN'` to deliver a Chinese interface (implemented via a temporary spec copy with `meta.locale` injected — your source specs are never modified).

## Prerequisites

The plugin invokes the [archify CLI](https://github.com/tt-a1i/archify) (a zero-dependency Node script) at build time to render diagrams. It is located in this order:

1. The `archifyBin` plugin option
2. The `ARCHIFY_BIN` environment variable
3. `~/.agents/skills/archify/bin/archify.mjs` (installed via `npx skills add tt-a1i/archify -g`)

## Installation

```bash
npm install rspress-plugin-archify
```

## Quick start

Register the plugin in `rspress.config.ts`:

```ts
import { defineConfig } from 'rspress';
import { pluginArchify } from 'rspress-plugin-archify';

export default defineConfig({
  plugins: [pluginArchify()],
});
```

Reference a diagram in Markdown (the spec path is relative to the project root):

```md
:::archify src=diagrams/deploy.workflow.json
:::
```

| Prop | Required | Description |
| --- | --- | --- |
| `src` | Yes | Path to an archify JSON spec |
| `type` | No | Diagram type; inferred from the `<name>.<type>.json` filename by default (architecture / workflow / sequence / dataflow / lifecycle) |
| `name` | No | Base name for the interactive HTML file; defaults to the name segment of the filename |

## Plugin options

```ts
interface ArchifyPluginOptions {
  /** Entry point of the archify CLI (default: ~/.agents/skills/archify/bin/archify.mjs) */
  archifyBin?: string;
  /** Output directory for interactive HTML (default: <docs root>/public/diagrams) */
  publicDiagramsDir?: string;
  /** Viewer UI language (e.g. 'zh-CN'); unset = deliver the spec as-is (English by default) */
  locale?: string;
  /** Strict mode: any rendering failure aborts the build. Defaults to strict in production builds; dev falls back to previously delivered artifacts with a warning */
  strict?: boolean;
}
```

## How it works

```
:::archify container
   │ Build time (remark plugin)
   ├─ archify validate <type> <spec> --quality showcase   # non-zero exit = failure
   ├─ archify deliver  <type> <spec> <public/diagrams>/<name>.html
   ├─ Extract embedded SVG + scoped styles → <name>.embed.html fragment
   └─ Inject a lightweight placeholder (.archify-lazy)
        │ Runtime (global bridge component)
        ├─ Scroll into view → fetch fragment → inject via outerHTML
        ├─ Hover toolbar: ▶ present (overlay) / ⛶ fullscreen / ↗ interactive
        └─ scroll/resize listeners + polling fallback
```

The same diagram referenced by multiple pages is rendered only once per build (in-memory cache keyed on spec content).

Three presentation layers are available: the static embed is pure SVG (no summary card or node index); the interactive version contains the full viewer (summary cards, node index, search, route exploration, export); presentation mode is the viewer with `?present=1` (node index hidden).

## Known behaviors

- After editing a JSON spec in dev mode, touch the corresponding Markdown file to trigger recompilation (production builds are unaffected).
- Production builds fail hard on validation errors or a missing CLI; dev mode falls back to previously delivered artifacts with a warning.

## Contributing

Contributions are welcome! Feel free to open an issue for bug reports, feature requests, or questions. If you'd like to submit a pull request:

```bash
git clone https://github.com/noobHuKai/rspress-plugin-archify.git
cd rspress-plugin-archify
pnpm install
pnpm build   # tsc → dist + copy lazy.css
```

Source layout: `src/index.ts` (plugin factory), `src/remark.ts` (container parsing and placeholder injection), `src/render.ts` (CLI orchestration, caching, delivery post-processing), `src/extract.ts` (SVG extractor), `src/wrapper.ts` (toolbar wrapper), `src/bridge.ts` (runtime bridge), `src/lazy.css` (placeholder styles).

## Acknowledgments

- [archify](https://github.com/tt-a1i/archify) — the diagram engine behind this plugin
- [Rspress](https://rspress.rs) — the documentation framework it plugs into

## License

[MIT](./LICENSE)
