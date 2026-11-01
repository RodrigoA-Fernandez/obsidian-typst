import { App, MarkdownView, Plugin, PluginSettingTab, Setting, loadMathJax } from 'obsidian';

import 'default.css';
import 'typlet/fonts/typlet.css';
import { renderToString } from 'typlet';

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

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new TypstSettingTab(this.app, this));

        await loadMathJax();
        if (!globalThis.MathJax) {
            throw new Error('MathJax failed to load.');
        }

        this._tex2chtml = globalThis.MathJax.tex2chtml;
        globalThis.MathJax.tex2chtml = (e: string, r: any) => {
            if (hasLatexCommand(e)) {
                return this._tex2chtml(e, r);
            }

            const mathExpr = String(e).trim();
            const isDisplay = !!(r && r.display);
            try {
                const markup = renderToString(mathExpr, {
                    displayMode: isDisplay,
                    preamble: this.settings.preamble,
                    strict: 'ignore',
                });
                const wrapper = document.createElement('span');
                wrapper.innerHTML = markup;
                return wrapper.firstElementChild ?? wrapper;
            } catch (err) {
                console.error('[obsidian-typst] Error rendering with Typlet:', err);
                if (!this.settings.fallbackToLatexOnError) {
                    const error = document.createElement('span');
                    error.className = 'typst-render-error';
                    error.textContent = mathExpr;
                    return error;
                }
                return this._tex2chtml(e, r);
            }
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

