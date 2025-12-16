import { App, MarkdownView, Plugin, PluginSettingTab, Setting, loadMathJax } from 'obsidian';

import 'katex/dist/katex.css';
import 'default.css';
import { $typst, MemoryAccessModel } from '@myriaddreamin/typst.ts';

interface TypstSettings {
    fallbackToLatexOnError: boolean;
    preamble: string;
}

const DEFAULT_SETTINGS: Partial<TypstSettings> = {
    fallbackToLatexOnError: false,
};

export default class Typst extends Plugin {
    settings: TypstSettings;
    _tex2chtml: any;
    private typstReady?: Promise<void>;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new TypstSettingTab(this.app, this));

        await loadMathJax();
        await this.initTypstOnce();

        if (!globalThis.MathJax) {
            throw new Error('MathJax failed to load.');
        }

        const parser = new DOMParser();
        this._tex2chtml = globalThis.MathJax.tex2chtml;


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
            placeholder.textContent = '...Renderizando...';

            // Lanzamos la tarea asíncrona que hará la compilación con Typst y reemplazará el placeholder
            (async () => {
                const mathExpr = String(e).trim();
                try {
                    // Normalize input text

                    const isDisplay = !!(r && r.display);
                    const padding = isDisplay ? " " : "";
                    const margin = isDisplay ? "10pt" : "0pt";

                    // Build a compact Typst document so the produced SVG is small
                    const mainContent = `
					#set text(size: 18pt, fill: rgb("#FFFFFF"));
					#set page(margin: ${margin}, height: auto, width: auto);
					${this.settings.preamble}
					$${padding}${mathExpr}${padding}$ 
					`;

                    //Renderizar SVG y guardarlo como string
                    const svgString = await $typst.svg({ mainContent });
                    let newNode: ChildNode | null = null;
                    const doc = parser.parseFromString(svgString, 'text/html');
                    newNode = doc.body.firstElementChild;
                    if (!newNode) {
                        throw (Error("No se encuentra el svg"));
                    }

                    if (newNode) {
                        let parent: ParentNode;
                        if (placeholder.parentNode) {
                            parent = placeholder.parentNode;
                        } else {
                            // Si el placeholder se ha borrado encontramos el elemento por id
                            const existing = document.querySelector(`[data-typst-pending="${id}"]`);
                            if (existing && existing.parentNode) {
                                parent = existing.parentNode;
                                existing.parentNode.replaceChild(newNode, existing);
                            } else {
                                throw Error("Math Element not found");
                            }
                        }

                        const styleMode = isDisplay ? "typst-display" : "typst-inline";
                        const parentMode = isDisplay ? "typst-math-display" : "typst-math-inline";
                        parent.removeChild(placeholder);
                        let container = parent.createEl('div', { cls: styleMode });
                        container.parentElement?.toggleClass(parentMode, true);
                        container.append(newNode);
                    }
                } catch (err) {
                    //Si el código typst da error mostramos el texto en rojo
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
                        } catch { }
                    }

                    const errNode = document.createElement('p');
                    errNode.textContent = mathExpr;
                    errNode.className = 'typst-render-error';
                    if (placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(errNode, placeholder);
                    } else {
                        const existing = document.querySelector(`[data-typst-pending="${id}"]`);
                        if (existing && existing.parentNode) existing.parentNode.replaceChild(errNode, existing);
                    }
                    console.error("[obsidian-typst] Error: ", err);
                }
            })();

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

    private async initTypstOnce(): Promise<void> {
        if (this.typstReady) return this.typstReady;
        this.typstReady = (async () => {
            $typst.setCompilerInitOptions({
                beforeBuild: [],
                getModule: () =>
                    'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm',
            });
            $typst.setRendererInitOptions({
                beforeBuild: [],
                getModule: () =>
                    'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm',
            });

            // 2) Intenta usar el helper que añade el package registry por defecto en navegador
            //    (equivalente a $typst.use(TypstSnippet.fetchPackageRegistry()))
            try {
                const TypstSnippet: any = ($typst as any).constructor;
                // esto añadirá MemoryAccessModel + FetchPackageRegistry internamente
                $typst.use(TypstSnippet.fetchPackageRegistry());
            } catch (e) {
                // console.warn('[obsidian-typst] No se pudo invocar fetchPackageRegistry automáticamente', e);
            }

            // 3) Forzar una compilación dummy para disparar la preparación interna
            try {
                await $typst.svg({ mainContent: '$x$' });
                // console.log('[obsidian-typst] Typst inicializado correctamente');
            } catch (err) {
                // algunos errores en la compilación dummy son normales; lo importante es que prepareUse() corrió
                console.warn('[obsidian-typst] Inicialización de Typst (dummy) completada con advertencia:', err);
            }

            // 4) fallback: si por alguna razón no se registró el registry automáticamente,
            //    registra explícitamente MemoryAccessModel + FetchPackageRegistry.
            //    (esto usa la clase que ya importaste: FetchPackageRegistry)
            try {
                await $typst.svg({ mainContent: '#import "@preview/example:0.1.0": add\n=1' });
            } catch (err) {
                const msg = String(err ?? '');
                if (msg.includes('Dummy Registry')) {
                    try {
                        const TypstSnippet: any = ($typst as any).constructor;

                        const am = new MemoryAccessModel();
                        $typst.use(TypstSnippet.withAccessModel(am), TypstSnippet.fetchPackageRegistry(am));
                        // reintentar init
                        await $typst.svg({ mainContent: '$x$' });
                        console.log('[obsidian-typst] Registry registrado explícitamente y Typst listo');
                    } catch (e2) {
                        console.error('[obsidian-typst] Fallback: no se pudo registrar package registry:', e2);
                    }
                }
            }
        })();
        return this.typstReady;
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
            .setDesc('Always fallback to LaTeX when Typst fails to render an expression (experimental).')
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.fallbackToLatexOnError).onChange(async (value) => {
                    this.plugin.settings.fallbackToLatexOnError = value;
                    await this.plugin.saveSettings();
                });
            });
        new Setting(containerEl)
            .setName('Custom Preamble')
            .setDesc('Custom commands to execute before any other typst code.')
            .addTextArea((text) => {
                text.setValue(this.plugin.settings.preamble).onChange(async (value) => {
                    this.plugin.settings.preamble = value;
                    await this.plugin.saveSettings();
                });
            })
    }


}


function hasLatexCommand(expr: string) {
    const regex = /\\\S/;
    return regex.test(expr);
}


