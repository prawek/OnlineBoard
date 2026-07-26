import { BoardEditor } from './board.js';
import { BoardSync } from './sync.js';
import { icon, renderIcons } from './icons.js';
import { readPreference, writePreference } from './storage.js';
import { validateImport } from './document.js';

const $ = id => document.getElementById(id);
renderIcons();

let toastTimer;
function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
}

function status(state) {
    const messages = { saved: 'Все изменения сохранены', busy: 'Сохраняем изменения…',
        offline: 'Нет связи · сохранено на устройстве', error: 'Нужен экспорт · сохранено на устройстве' };
    $('save-status').dataset.state = state;
    $('save-status').lastElementChild.textContent = messages[state] || state;
}

const tools = {
    select: 'Выделение', hand: 'Перемещение', draw: 'Карандаш', text: 'Текст',
    sticky: 'Стикер', rect: 'Прямоугольник', ellipse: 'Эллипс', line: 'Линия', erase: 'Ластик',
};

let editor;
let sync;
let reconcileTimer;
let needsReconcile = false;
let ready = false;

function updateUI(state) {
    document.querySelectorAll('[data-tool]').forEach(button => {
        const active = button.dataset.tool === state.mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active);
    });
    $('tool-name').textContent = state.selected.length ? `Выбрано: ${state.selected.length}` : tools[state.mode];
    $('undo-button').disabled = !state.undo;
    $('redo-button').disabled = !state.redo;
    $('selection-actions').hidden = !state.selected.length;
    const isText = ['text', 'sticky'].includes(state.mode) || state.selected.some(object => ['i-text', 'textbox', 'text', 'sticky-note'].includes(object.type));
    $('font-property').hidden = !isText;
    $('color-property').hidden = ['hand', 'erase'].includes(state.mode);
    $('stroke-property').hidden = isText || ['hand', 'erase'].includes(state.mode);
    $('fill-property').hidden = !['rect', 'ellipse'].includes(state.mode)
        && !state.selected.some(object => ['rect', 'ellipse', 'circle', 'triangle'].includes(object.type));
    $('color-picker').value = state.color;
    $('color-label').textContent = state.color.toUpperCase();
    document.querySelectorAll('[data-color]').forEach(button => {
        const active = button.dataset.color === state.color.toLowerCase();
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active);
    });
    $('stroke-width').value = state.strokeWidth;
    $('shape-fill').value = state.fillMode;
    $('stroke-value').textContent = `${state.strokeWidth} px`;
    if ([...$('font-size').options].some(option => Number(option.value) === state.fontSize)) $('font-size').value = state.fontSize;
    if (document.activeElement !== $('board-title')) $('board-title').value = state.title;
    document.title = `${state.title} · Online Board`;
}

function scheduleReconcile() {
    if (!needsReconcile || !ready) return;
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
        if (!editor.busy) { needsReconcile = false; sync.refresh(); }
    }, 120);
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    $('theme-toggle').setAttribute('aria-label', theme === 'dark' ? 'Светлая тема' : 'Тёмная тема');
    document.querySelector('meta[name=theme-color]').content = theme === 'dark' ? '#1b1d24' : '#f6f5f2';
    writePreference('theme', theme);
    if (editor && !editor.canvas.getActiveObjects().length && ['#292d3e', '#e7e7ee'].includes(editor.color)) {
        editor.color = theme === 'dark' ? '#e7e7ee' : '#292d3e';
        writePreference('color', editor.color);
        editor.configureMode();
        editor.emitUI();
    }
}

applyTheme(readPreference('theme', 'light'));
const gridVisible = readPreference('grid', true);
function updateGrid(visible) {
    $('board-container').classList.toggle('show-grid', visible);
    $('grid-toggle').innerHTML = `${icon('grid')}${visible ? 'Скрыть' : 'Показать'} сетку`;
    $('grid-toggle').setAttribute('aria-pressed', visible);
    writePreference('grid', visible);
}
updateGrid(gridVisible);

function updateGridStyle(style) {
    const gridStyle = style === 'lines' ? 'lines' : 'dots';
    $('board-container').dataset.gridStyle = gridStyle;
    $('grid-style-toggle').innerHTML = `${icon('grid')}Сетка: ${gridStyle === 'lines' ? 'линии' : 'точки'}`;
    $('grid-style-toggle').setAttribute('aria-pressed', gridStyle === 'lines');
    $('grid-style-toggle').title = gridStyle === 'lines' ? 'Переключить на точки' : 'Переключить на обычную сетку';
    writePreference('grid-style', gridStyle);
}
updateGridStyle(readPreference('grid-style', 'dots'));

function closeMenus() {
    for (const name of ['export', 'more']) {
        $(`${name}-menu`).hidden = true;
        $(`${name}-toggle`).setAttribute('aria-expanded', 'false');
    }
}

function confirmAction(title, description, acceptLabel) {
    closeMenus();
    const dialog = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-description').textContent = description;
    $('confirm-accept').textContent = acceptLabel;
    dialog.showModal();
    return new Promise(resolve => {
        let accepted = false;
        $('confirm-accept').onclick = () => { accepted = true; dialog.close(); };
        $('confirm-cancel').onclick = () => dialog.close();
        dialog.addEventListener('close', () => resolve(accepted), { once: true });
    });
}

function download(blob, extension) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${editor.title.replace(/[<>:"/\\|?*]/g, '_')}.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function run(action) {
    if (!ready || editor.loading) return;
    if (editor.editing) editor.canvas.getActiveObject().exitEditing();
    closeMenus();
    try {
        if (action === 'export-json') {
            download(new Blob([JSON.stringify(editor.snapshot(), null, 2)], { type: 'application/json' }), 'json');
            toast('Копия доски сохранена в JSON');
        } else if (action === 'export-png') {
            download(await editor.exportPNG(), 'png');
        } else if (action === 'import') {
            $('board-upload').click();
        } else if (action === 'fit') editor.fit();
        else if (action === 'clear' && editor.canvas.size()) {
            if (await confirmAction('Очистить доску?', 'Все объекты будут удалены. Действие можно отменить с помощью Ctrl+Z.', 'Очистить доску')) editor.clear();
        }
    } catch (error) { toast(error.message); }
}

function bindUI() {
    document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => editor.setMode(button.dataset.tool)));
    document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => editor.setColor(button.dataset.color)));
    document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => run(button.dataset.action)));
    $('image-button').addEventListener('click', () => $('image-upload').click());
    $('color-picker').addEventListener('input', event => editor.setColor(event.target.value));
    // One history entry per slider gesture, rather than one for every pixel.
    $('stroke-width').addEventListener('input', event => {
        $('stroke-value').textContent = `${event.target.value} px`;
        editor.canvas.freeDrawingBrush.width = Number(event.target.value);
    });
    $('stroke-width').addEventListener('change', event => editor.setStroke(Number(event.target.value)));
    $('font-size').addEventListener('change', event => editor.setFontSize(Number(event.target.value)));
    $('shape-fill').addEventListener('change', event => editor.setFill(event.target.value));
    $('duplicate-button').addEventListener('click', () => editor.duplicate().catch(error => toast(error.message)));
    $('delete-button').addEventListener('click', () => editor.removeSelected());
    $('undo-button').addEventListener('click', () => editor.travel('undo'));
    $('redo-button').addEventListener('click', () => editor.travel('redo'));
    $('board-title').addEventListener('change', event => editor.setTitle(event.target.value));
    $('board-title').addEventListener('keydown', event => {
        if (event.code === 'Enter') event.target.blur();
        if (event.code === 'Escape') { event.target.value = editor.title; event.target.blur(); }
    });
    $('theme-toggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    $('grid-toggle').addEventListener('click', () => { updateGrid(!$('board-container').classList.contains('show-grid')); closeMenus(); });
    $('grid-style-toggle').addEventListener('click', () => {
        updateGridStyle($('board-container').dataset.gridStyle === 'lines' ? 'dots' : 'lines');
        updateGrid(true);
        closeMenus();
    });
    $('zoom-in').addEventListener('click', () => editor.zoom(editor.canvas.getZoom() * 1.2));
    $('zoom-out').addEventListener('click', () => editor.zoom(editor.canvas.getZoom() / 1.2));
    $('zoom-reset').addEventListener('click', () => editor.zoom(1));
    $('fit-button').addEventListener('click', () => editor.fit());
    $('help-button').addEventListener('click', () => { closeMenus(); $('help-dialog').showModal(); });
    document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    }));
    for (const name of ['export', 'more']) {
        $(`${name}-toggle`).addEventListener('click', () => {
            const open = $(`${name}-menu`).hidden;
            closeMenus();
            $(`${name}-menu`).hidden = !open;
            $(`${name}-toggle`).setAttribute('aria-expanded', open);
        });
    }
    document.addEventListener('click', event => {
        if (!event.target.closest('.dropdown-anchor')) closeMenus();
    });
    $('image-upload').addEventListener('change', async event => {
        try { if (event.target.files[0]) await editor.addImage(event.target.files[0]); }
        catch (error) { toast(error.message); }
        finally { event.target.value = ''; }
    });
    $('board-upload').addEventListener('change', async event => {
        const file = event.target.files[0];
        try {
            if (!file) return;
            if (file.size > 20 * 1024 * 1024) throw new Error('Размер файла доски должен быть меньше 20 МБ.');
            let parsed;
            try { parsed = JSON.parse(await file.text()); }
            catch { throw new Error('Не удалось прочитать JSON. Проверьте файл доски.'); }
            const document = validateImport(parsed);
            if (editor.canvas.size() && !await confirmAction('Открыть другую доску?', 'Содержимое файла заменит текущую доску для всех участников. Замену можно отменить с помощью Ctrl+Z.', 'Открыть файл')) return;
            await editor.replace(document);
            toast('Доска открыта');
        } catch (error) { toast(error.message); }
        finally { event.target.value = ''; }
    });
}

function isInput(target) {
    return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
}

function bindKeyboard() {
    const shortcuts = { KeyV: 'select', KeyH: 'hand', KeyP: 'draw', KeyT: 'text', KeyN: 'sticky',
        KeyR: 'rect', KeyO: 'ellipse', KeyL: 'line', KeyE: 'erase' };
    window.addEventListener('keydown', event => {
        if (!ready || editor.loading) return;
        if (document.querySelector('dialog[open]')) return;
        if (event.code === 'Escape') {
            closeMenus();
            if (editor.editing) editor.canvas.getActiveObject().exitEditing();
            editor.canvas.discardActiveObject();
            editor.setMode('select');
            if (isInput(event.target)) event.target.blur();
            return;
        }
        if (isInput(event.target) || editor.editing) return;
        const command = event.ctrlKey || event.metaKey;
        if (command && event.code === 'KeyZ') {
            event.preventDefault();
            editor.travel(event.shiftKey ? 'redo' : 'undo');
        } else if (command && event.code === 'KeyY') {
            event.preventDefault(); editor.travel('redo');
        } else if (command && event.code === 'KeyD') {
            event.preventDefault(); editor.duplicate().catch(error => toast(error.message));
        } else if (command && event.code === 'KeyA') {
            event.preventDefault(); editor.selectAll();
        } else if (command && event.code === 'Digit0') {
            event.preventDefault(); editor.zoom(1);
        } else if (command && event.code === 'KeyS') {
            event.preventDefault(); run('export-json');
        } else if (event.code === 'Space' && !command) {
            event.preventDefault(); editor.setSpace(true);
        } else if (['Delete', 'Backspace'].includes(event.code)) {
            event.preventDefault(); editor.removeSelected();
        } else if (event.code.startsWith('Arrow') && !command && editor.canvas.getActiveObject()) {
            event.preventDefault();
            const distance = event.shiftKey ? 10 : 1;
            editor.nudge(event.code === 'ArrowRight' ? distance : event.code === 'ArrowLeft' ? -distance : 0,
                event.code === 'ArrowDown' ? distance : event.code === 'ArrowUp' ? -distance : 0);
        } else if (event.shiftKey && event.code === 'Digit1') {
            event.preventDefault(); editor.fit();
        } else if (!command && !event.altKey) {
            if (shortcuts[event.code]) { event.preventDefault(); editor.setMode(shortcuts[event.code]); }
            else if (event.code === 'KeyI') $('image-upload').click();
            else if (event.code === 'Equal' || event.code === 'NumpadAdd') editor.zoom(editor.canvas.getZoom() * 1.2);
            else if (event.code === 'Minus' || event.code === 'NumpadSubtract') editor.zoom(editor.canvas.getZoom() / 1.2);
            else if (event.key === '?') $('help-dialog').showModal();
        }
    });
    window.addEventListener('keyup', event => {
        if (event.code === 'Space' && editor.space) editor.setSpace(false);
    });
    const copy = event => {
        if (!ready || isInput(event.target) || editor.editing || document.querySelector('dialog[open]')) return;
        const objects = editor.copySelection();
        if (!objects.length || !event.clipboardData) return;
        event.preventDefault();
        event.clipboardData.setData('application/x-online-board', JSON.stringify({ schemaVersion: 1, title: editor.title, objects }));
        event.clipboardData.setData('text/plain', objects.map(object => object.text || '').filter(Boolean).join('\n') || 'Объекты Online Board');
        if (event.type === 'cut') editor.removeSelected();
    };
    window.addEventListener('copy', copy);
    window.addEventListener('cut', copy);
    window.addEventListener('paste', async event => {
        if (!ready || isInput(event.target) || editor.editing || document.querySelector('dialog[open]')) return;
        const image = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
        try {
            const boardData = event.clipboardData?.getData('application/x-online-board');
            if (boardData) {
                event.preventDefault();
                const data = validateImport(JSON.parse(boardData));
                await editor.pasteObjects(data.objects);
            } else if (image) { event.preventDefault(); await editor.addImage(image.getAsFile()); }
            else {
                const text = event.clipboardData?.getData('text/plain');
                if (text) { event.preventDefault(); editor.addText(editor.center(), false, text.slice(0, 50000)); }
            }
        } catch (error) { toast(error.message); }
    });
}

function bindDrop() {
    let depth = 0;
    window.addEventListener('dragenter', event => {
        if (!event.dataTransfer?.types.includes('Files')) return;
        event.preventDefault(); depth++;
        $('drop-overlay').hidden = false;
    });
    window.addEventListener('dragover', event => {
        if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
    });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop-overlay').hidden = true; } });
    window.addEventListener('drop', async event => {
        event.preventDefault(); depth = 0; $('drop-overlay').hidden = true;
        if (!ready || editor.loading || document.querySelector('dialog[open]')) return;
        const file = event.dataTransfer?.files[0];
        if (!file) return;
        const point = editor.canvas.getPointer(event);
        try { await editor.addImage(file, point); }
        catch (error) { toast(error.message); }
    });
}

async function start() {
    $('busy-overlay').hidden = false;
    if (!globalThis.fabric) throw new Error('Не удалось загрузить библиотеку холста. Проверьте static/vendor.');
    editor = new BoardEditor({
        onChange: (mutation, document) => sync.enqueue(mutation, document),
        onUI: updateUI, onIdle: scheduleReconcile, onError: toast,
    });
    sync = new BoardSync({
        onDocument: async document => {
            if (editor.busy) { needsReconcile = true; return; }
            await editor.load(document);
        }, onStatus: status, onError: toast,
    });
    await sync.start();
    ready = true;
    $('busy-overlay').hidden = true;
    bindUI();
    bindKeyboard();
    bindDrop();
    editor.emitUI();
    // Commit the active textarea before the page is suspended; cache writes are synchronous for text.
    window.addEventListener('pagehide', () => {
        if (editor.editing) editor.commit({ history: false });
        sync.cache.write(sync.document, sync.outbox);
    });
    window.addEventListener('beforeunload', event => {
        if (sync.blocked) { event.preventDefault(); event.returnValue = ''; }
    });
}

start().catch(error => {
    $('busy-overlay').hidden = true;
    status('error');
    toast(error.message || 'Не удалось открыть доску. Перезагрузите страницу.');
    console.error(error);
});
