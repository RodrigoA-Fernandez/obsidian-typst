import { App, MarkdownView, Plugin, PluginSettingTab, Setting, loadMathJax } from 'obsidian';

import 'katex/dist/katex.css';
import 'default.css';
import { $typst } from '@myriaddreamin/typst.ts';

interface TypstSettings {
    fallbackToLatexOnError: boolean;
}

const DEFAULT_SETTINGS: Partial<TypstSettings> = {
    fallbackToLatexOnError: false,
};

export default class Typst extends Plugin {
    settings: TypstSettings;
    _tex2chtml: any;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new TypstSettingTab(this.app, this));

        await loadMathJax();

        if (!globalThis.MathJax) {
            throw new Error('MathJax failed to load.');
        }

        const parser = new DOMParser();
        this._tex2chtml = globalThis.MathJax.tex2chtml;

        // Configuración de WASM: (POC) uso de los .wasm en CDN como en el ejemplo.
        $typst.setCompilerInitOptions({
            getModule: () =>
                'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm',
        });
        $typst.setRendererInitOptions({
            getModule: () =>
                'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm',
        });

        // Contador para ids de placeholders
        let typstPendingId = 0;

        // Reemplazamos la función sync tex2chtml de MathJax por una que devuelve
        // inmediatamente un placeholder y después lo rellena asíncronamente
        globalThis.MathJax.tex2chtml = (e: string, r: any) => {
            // Si el texto contiene comandos LaTeX explícitos (backslash), dejamos pasar a MathJax
            if (hasLatexCommand(e)) {
                return this._tex2chtml(e, r);
            }

            // Placeholder síncrono que devolvemos inmediatamente
            const placeholder = document.createElement('span');
            const id = `typst-pending-${Date.now()}-${typstPendingId++}`;
            placeholder.setAttribute('data-typst-pending', id);
            placeholder.className = 'typst-pending';
            placeholder.textContent = '…';

            // Lanzamos la tarea asíncrona que hará la compilación con Typst y reemplazará el placeholder
            (async () => {
                try {
                    // Normalize input text
                    const mathExpr = String(e).trim();

                    const isDisplay = !!(r && r.display);
                    const padding = isDisplay ? " " : "";

                    // Build a compact Typst document so the produced SVG is small
                    const mainContent = `
					#set text(size: 16pt, fill: rgb("#FFFFFF"));
					#set page(margin: 10pt, height: auto, width: auto);
					 $${padding}${mathExpr}${padding}$ 
					`;

                    // Render and wait for svg string
                    const svgString = await $typst.svg({ mainContent });
                    console.log(mainContent);

                    // Parse as SVG first
                    let newNode: ChildNode | null = null;
                    try {
                        const doc = parser.parseFromString(svgString, 'image/svg+xml');
                        if (doc && doc.documentElement && doc.documentElement.nodeName.toLowerCase() === 'svg') {
                            newNode = doc.documentElement;
							const styleMode = isDisplay ? "typst-display": "typst-inline";
                            (newNode as SVGElement).classList.add('typst-compact-svg');
                            (newNode as SVGElement).classList.add(styleMode);
                        }
                    } catch {
                        // ignore and fallback
                    }

                    // Fallback to HTML parse if not valid SVG
                    if (!newNode) {
                        const doc = parser.parseFromString(svgString, 'text/html');
                        newNode = doc.body.firstChild;
                        if (newNode && newNode.nodeType === Node.ELEMENT_NODE) {
                            (newNode as HTMLElement).classList.add('typst-compact-svg');
                        }
                    }

                    if (newNode) {
                        if (placeholder.parentNode) {
                            placeholder.parentNode.replaceChild(newNode, placeholder);
                        } else {
                            // If placeholder not attached anymore, find by data attr
                            const existing = document.querySelector(`[data-typst-pending="${id}"]`);
                            if (existing && existing.parentNode) {
                                existing.parentNode.replaceChild(newNode, existing);
                            }
                        }
                    } else {
                        // If response invalid, show original input in red (no flashing big error)
                        const errNode = document.createElement('span');
                        errNode.textContent = mathExpr;
                        errNode.className = 'typst-render-error';
                        if (placeholder.parentNode) {
                            placeholder.parentNode.replaceChild(errNode, placeholder);
                        } else {
                            const existing = document.querySelector(`[data-typst-pending="${id}"]`);
                            if (existing && existing.parentNode) existing.parentNode.replaceChild(errNode, existing);
                        }
                        // trigger fade-in
                        // use requestAnimationFrame to ensure the element is in the DOM
                        requestAnimationFrame(() => errNode.classList.add('show'));
                    }
                } catch (err) {
                    // In case of error, prefer to show original text in red (non-intrusive).
                    // console.error('Typst render error:', err);

                    // If configured, try fallback to LaTeX rendering synchronously
                    if (this.settings.fallbackToLatexOnError) {
                        try {
                            const latexNode = this._tex2chtml(e, r);
                            if (placeholder.parentNode) {
                                placeholder.parentNode.replaceChild(latexNode, placeholder);
                                return;
                            } else {
                                const existing = document.querySelector(`[data-typst-pending="${id}"]`);
                                if (existing && existing.parentNode) {
                                    existing.parentNode.replaceChild(latexNode, existing);
                                    return;
                                }
                            }
                        } catch {
                            // if fallback fails, continue to show input in red
                        }
                    }

                    const cleaned = String(e).trim();
                    const errNode = document.createElement('span');
                    errNode.textContent = cleaned; // safe: textContent avoids HTML injection
                    errNode.className = 'typst-render-error';
                    if (placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(errNode, placeholder);
                    } else {
                        const existing = document.querySelector(`[data-typst-pending="${id}"]`);
                        if (existing && existing.parentNode) existing.parentNode.replaceChild(errNode, existing);
                    }
                    requestAnimationFrame(() => errNode.classList.add('show'));
                }
            })();

            // Devolvemos el placeholder inmediatamente (API síncrona)
            return placeholder;
        };

        // Forzamos re-render del preview para que MathJax aplique la nueva función
        this.app.workspace.getActiveViewOfType(MarkdownView)?.previewMode.rerender(true);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        globalThis.MathJax.tex2chtml = this._tex2chtml;
        this.app.workspace.getActiveViewOfType(MarkdownView)?.previewMode.rerender(true);
    }
}

export class TypstSettingTab extends PluginSettingTab {
    plugin: Typst;

    constructor(app: App, plugin: Typst) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Fallback to LaTeX on error')
            .setDesc('Always fallback to LaTeX when Typst fails to render an expression (experimental)')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.fallbackToLatexOnError).onChange(async (value) => {
                    this.plugin.settings.fallbackToLatexOnError = value;
                    await this.plugin.saveSettings();
                });
            });
    }
}

function hasLatexCommand(expr: string) {
    const regex = /\\\S/;
    return regex.test(expr);
}
