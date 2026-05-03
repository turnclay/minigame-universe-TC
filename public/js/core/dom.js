// /js/core/dom.js
// Helpers DOM intelligents et compatibles avec toute ton architecture

// Sélecteur intelligent :
// - $("id") → getElementById("id")
// - $("#id") → querySelector("#id")
// - $(".class") → querySelector(".class")
export function $(selector) {
    if (!selector) return null;

    // Cas 1 : ID sans #
    if (!selector.startsWith("#") && !selector.startsWith(".")) {
        return document.getElementById(selector);
    }

    // Cas 2 : sélecteur CSS
    return document.querySelector(selector);
}

// Sélecteur multiple
export function $$(selector) {
    return document.querySelectorAll(selector);
}

// Helpers visibilité
export function show(idOrEl) {
    const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
    if (!el) return;

    el.hidden = false;
    el.style.display = ""; // laisse le CSS décider
}

export function hide(idOrEl) {
    const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
    if (!el) return;

    el.hidden = true;
}

// Fade-out progressif
export function fadeOut(idOrEl, duration = 300) {
    const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
    if (!el) return;

    el.style.transition = `opacity ${duration}ms`;
    el.style.opacity = 1;

    requestAnimationFrame(() => {
        el.style.opacity = 0;
    });

    setTimeout(() => {
        el.hidden = true;
        el.style.opacity = 1;
    }, duration);
}

// Fade-in progressif
export function fadeIn(idOrEl, duration = 300) {
    const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
    if (!el) return;

    el.hidden = false;
    el.style.opacity = 0;
    el.style.transition = `opacity ${duration}ms`;

    requestAnimationFrame(() => {
        el.style.opacity = 1;
    });
}