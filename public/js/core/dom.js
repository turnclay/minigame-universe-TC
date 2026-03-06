// /js/core/dom.js
// Helpers DOM intelligents et compatibles avec toute ton architecture

export function $(selector) {
    if (!selector) return null;
    if (!selector.startsWith("#") && !selector.startsWith(".")) {
        return document.getElementById(selector);
    }
    return document.querySelector(selector);
}

export function $$(selector) {
    return document.querySelectorAll(selector);
}

export function show(idOrEl) {
    const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
    if (!el) return;
    el.hidden = false;
    el.style.display = "";
}

export function hide(idOrEl) {
    const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
    if (!el) return;
    el.hidden = true;
}

export function fadeOut(idOrEl, duration = 300) {
    const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
    if (!el) return;
    el.style.transition = `opacity ${duration}ms`;
    el.style.opacity = 1;
    requestAnimationFrame(() => { el.style.opacity = 0; });
    setTimeout(() => { el.hidden = true; el.style.opacity = 1; }, duration);
}

export function fadeIn(idOrEl, duration = 300) {
    const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
    if (!el) return;
    el.hidden = false;
    el.style.opacity = 0;
    el.style.transition = `opacity ${duration}ms`;
    requestAnimationFrame(() => { el.style.opacity = 1; });
}