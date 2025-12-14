import { App, Modal, Notice, Plugin } from 'obsidian';

/**
 * Plugin skeleton modified to:
 * - Detect math elements rendered in the document
 * - Inspect the original TeX source (if available) or the text content for occurrences
 *   of the pattern: \<...>  (a backslash followed by <...>), detected by the regex /\\<[^>]+>/
 * - If such a pair is present, keep/use the default renderer (KaTeX) output (no-op)
 * - If such a pair is NOT present, run a dummy Typst-render function and replace the element
 *
 * NOTE:
 * - Obsidian's exact DOM and attributes for math elements can vary by version. This example
 *   tries several selectors and looks for a `data-tex` attribute (common when KaTeX preserves the
 *   source). If your setup differs, adjust the selectors / attribute accessors accordingly.
 */

export default class MyPlugin extends Plugin {
    async onload() {
        console.log('Loading typst/KaTeX switcher plugin (demo)...');
        this.registerMarkdownPostProcessor((element: HTMLElement, ctx: any) => {
            // Try a set of selectors that may represent rendered math elements.
            // Adjust these selectors if your Obsidian version uses different classes.
            const selectors = [
                'div.math',        // block math common class
                'div.math-block',  // alternate
                'span.math',       // inline math common class
                'span.inline-math',
                'code[data-tex]',  // if KaTeX/Obsidian stores source in data-tex on a code element
            ];

            const mathElements = new Set<HTMLElement>();
            for (const sel of selectors) {
                element.querySelectorAll<HTMLElement>(sel).forEach(e => mathElements.add(e));
            }
            console.log(mathElements);

            // If nothing found by selectors, also scan for elements that include a KaTeX wrapper
            // (kaTeX often produces elements with class 'katex' inside). This is a fallback.
            if (mathElements.size === 0) {
                element.querySelectorAll<HTMLElement>('.katex, .katex-display').forEach(k => {
                    // climb up to a parent that likely represents the math container
                    const parent = k.closest('div, span') as HTMLElement | null;
                    if (parent) mathElements.add(parent);
                });
            }

            mathElements.forEach((mEl) => {
                // Attempt to get the original TeX source. Obsidian sometimes stores it in data-tex.
                const source =
                    (mEl.getAttribute && (mEl.getAttribute('data-tex') ?? mEl.getAttribute('data-latex'))) ||
                    mEl.getAttribute?.('data-tex') ||
                    mEl.textContent ||
                    '';

                // Detect \<!something>
                const backslashAnglePairRegex = /\\<[^>]+>/;

                if (backslashAnglePairRegex.test(source)) {
                    // Found a \ <...> pair: use default renderer (KaTeX).
                    // In most cases KaTeX has already rendered the element, so we leave it as-is.
                    // If you'd want to forcibly re-run KaTeX or restore original KaTeX output,
                    // you'd implement that here.
                    return;
                } else {
                    // No \ <...> pair: use Typst renderer.
                    // For this request we call a dummy function to simulate Typst rendering.
                    const typstHtml = dummyTypstRender(source);
                    // Replace the element contents with the dummy Typst output.
                    // Keep an identifying class for styling/debugging.
                    mEl.classList.add('typst-rendered-by-plugin');
                    mEl.innerHTML = typstHtml;
                }
            });
        });
    }

    onunload() {
        console.log('Unloading typst/KaTeX switcher plugin (demo)...');
    }
}

/**
 * Dummy Typst renderer (placeholder).
 * Replace this with an actual Typst rendering pipeline when available.
 */
function dummyTypstRender(source: string): string {
    // Simple HTML-escaped placeholder output so tests can see the replacement.
    const escaped = escapeHtml(source);
    return `<span style="color:var(--text-muted); font-style:italic;">[Typst placeholder render]</span>` +
        `<span style="display:block; margin-top:0.2em; padding:0.2em 0.4em; border-radius:4px; background:var(--background-modifier-border);">` +
        `${escaped}</span>`;
}

/** Small helper to escape HTML to avoid XSS when injecting raw source into innerHTML */
function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
