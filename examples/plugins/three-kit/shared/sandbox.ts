/**
 * Iframe-sandbox source for the editor canvas preview.
 *
 * The host's `ModuleSandboxFrame` mounts an iframe whose import map is
 * built from the site's runtime dependency cache (`/_pb/runtime/cache/...`
 * URLs). Inside the iframe, `import * as THREE from 'three'` resolves via
 * the import map to the host's locally-installed copy — same URL the
 * published page uses.
 *
 * Each module's `editorRuntime.sandbox.source` is a small ESM module that
 * exports `mount(root, context)`. `mount` creates a `<canvas>`, runs the
 * `initSource`, and returns `{ update, cleanup }` so the host can re-run
 * the init when the user edits a prop without reloading the iframe.
 */
import type { PluginEditorRuntime } from '@core/plugin-sdk'
import type { StageAspect } from './publish'

interface SandboxConfig {
  aspect: StageAspect
  initSource: string
  /** Optional extra imports — bare specifiers resolved by the iframe import map. */
  extraImports?: Array<{ specifier: string; named: string }>
  /** Min iframe height in pixels — overrides the host default of 360. */
  minHeight?: number
  /**
   * Hero modules render their own chrome (eyebrow / title / body) on top of
   * the canvas. Default false: the sandbox just emits a stage container.
   */
  hero?: boolean
}

function buildSandboxImports(extra?: SandboxConfig['extraImports']): string {
  const lines = [`import * as THREE from 'three';`]
  if (!extra) return lines.join('\n')
  for (const imp of extra) {
    // Bare specifier — the iframe's import map resolves both the bare
    // `three` import and the subpath `three/examples/jsm/...` to the same
    // package directory, so addons import the same Three.js instance the
    // page-level `import 'three'` sees.
    lines.push(`import { ${imp.named} } from 'three/examples/jsm/${imp.specifier}.js';`)
  }
  return lines.join('\n')
}

const STAGE_STYLES = `
  :host,html,body{margin:0;padding:0;width:100%;height:100%;background:#0f172a;}
  .threekit-stage{position:relative;width:100%;height:100%;}
  .threekit-stage canvas{display:block;width:100%;height:100%;}
  .threekit-hero{position:relative;width:100%;height:100%;background:#020617;color:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
  .threekit-hero canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
  .threekit-hero__content{position:relative;display:grid;gap:12px;align-content:center;justify-items:center;text-align:center;padding:48px 24px;min-height:100%;z-index:1;}
  .threekit-hero__eyebrow{letter-spacing:0.22em;text-transform:uppercase;font-size:0.75rem;font-weight:600;color:rgba(248,250,252,0.7);}
  .threekit-hero__title{margin:0;font-size:clamp(1.6rem,4vw,2.6rem);font-weight:700;line-height:1.1;}
  .threekit-hero__body{margin:0;max-width:480px;color:rgba(226,232,240,0.85);font-size:1rem;line-height:1.6;}
`

/**
 * Build the ESM source string the iframe runs. The host expects
 * `mount(root, context) => { update?, cleanup? }`. The shape below is the
 * standard pattern from the host's docs (`docs/features/plugin-system.md`).
 *
 * The string is template-built once at build time and shipped verbatim
 * into the iframe via `srcDoc`. No interpolation happens at runtime.
 */
export function makeSandboxRuntime(config: SandboxConfig): PluginEditorRuntime {
  const imports = buildSandboxImports(config.extraImports)
  const containerOpen = config.hero
    ? `'<section class="threekit-hero"><canvas></canvas><div class="threekit-hero__content"><span class="threekit-hero__eyebrow"></span><h1 class="threekit-hero__title"></h1><p class="threekit-hero__body"></p></div></section>'`
    : `'<div class="threekit-stage"><canvas></canvas></div>'`
  const source = `
${imports}

const STYLES = ${JSON.stringify(STAGE_STYLES)};

function ensureStyleSheet() {
  if (document.getElementById('threekit-sandbox-styles')) return;
  const style = document.createElement('style');
  style.id = 'threekit-sandbox-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function applyHeroText(root, props) {
  const eyebrow = root.querySelector('.threekit-hero__eyebrow');
  const title = root.querySelector('.threekit-hero__title');
  const body = root.querySelector('.threekit-hero__body');
  if (eyebrow) eyebrow.textContent = String(props.eyebrow ?? '');
  if (title) title.textContent = String(props.title ?? '');
  if (body) body.textContent = String(props.body ?? '');
}

function buildOptions(props) {
  // Modules pass their full props bag as init options — same shape as the
  // published render. The init function reads only the keys it knows about.
  return props;
}

let current = null;

function init(THREE, canvas, options) {
${config.initSource}
}

export function mount(root, context) {
  ensureStyleSheet();
  root.innerHTML = ${containerOpen};
  const isHero = ${config.hero ? 'true' : 'false'};
  if (isHero) applyHeroText(root, context.props);
  const canvas = root.querySelector('canvas');
  if (!canvas) throw new Error('threekit-sandbox: canvas missing');
  const cleanup = init(THREE, canvas, buildOptions(context.props));
  current = { canvas, cleanup, isHero };
  return {
    update(nextRoot, nextContext) {
      // Re-init for clean state on any prop change. Three.js init costs
      // are negligible for these small scenes and avoids per-module
      // patching boilerplate. Hero text updates without a re-init.
      if (current?.cleanup) try { current.cleanup(); } catch (_) {}
      nextRoot.innerHTML = ${containerOpen};
      if (current?.isHero) applyHeroText(nextRoot, nextContext.props);
      const nextCanvas = nextRoot.querySelector('canvas');
      const nextCleanup = init(THREE, nextCanvas, buildOptions(nextContext.props));
      current = { canvas: nextCanvas, cleanup: nextCleanup, isHero: current?.isHero ?? false };
    },
    cleanup() {
      if (current?.cleanup) try { current.cleanup(); } catch (_) {}
      current = null;
    },
  };
}
`
  return {
    sandbox: {
      source,
      minHeight: config.minHeight ?? (config.hero ? 320 : 280),
    },
  }
}
