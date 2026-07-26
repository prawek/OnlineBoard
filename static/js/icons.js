const paths = {
    cursor: '<path d="m4 3 7.5 17 2.2-6.3L20 11.5 4 3Z"/>',
    hand: '<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v5c0 5-2 8-7 8-3 0-5-2-6-4l-3-5a1.6 1.6 0 0 1 2.5-2L8 14"/>',
    pen: '<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14l-1 7 1-1Z"/>',
    text: '<path d="M4 6V4h16v2M12 4v16m-4 0h8"/>',
    sticky: '<path d="M14 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9l-7 7Z"/><path d="M14 21v-5a2 2 0 0 1 2-2h5M7 8h10M7 12h5"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    line: '<path d="m5 19 14-14"/><circle cx="5" cy="19" r="1"/><circle cx="19" cy="5" r="1"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    eraser: '<path d="m13 4 7 7a2 2 0 0 1 0 3l-7 7H8l-5-5a2 2 0 0 1 0-3l7-9a2 2 0 0 1 3 0ZM7 9l9 9M13 21h8"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-2"/>',
    redo: '<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12h2"/>',
    moon: '<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.2-1.5 2.5M12 17h.01"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18m6-18v18M3 9h18M3 15h18"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    layers: '<path d="m12 3 10 6-10 6L2 9l10-6ZM2 13l10 6 10-6M2 17l10 6 10-6"/>',
    sliders: '<path d="M4 7h8m4 0h4M4 17h2m4 0h10"/><circle cx="14" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
    'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
    'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7M6 10h12"/>',
    scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
};

export function icon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.square}</svg>`;
}

export function renderIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach(element => {
        element.innerHTML = icon(element.dataset.icon);
    });
}
