/** Fabric adapter: canvas interactions, serialization, and local history. */
import { applyMutation, diff, EMPTY_DOCUMENT, hasChanges, History, mutationFromChange, SERIALIZED_PROPERTIES, uid } from './document.js';
import { readPreference, writePreference } from './storage.js';
import { registerStickyNote } from './sticky-note.js';

const TEXT_TYPES = new Set(['text', 'i-text', 'textbox', 'sticky-note']);
const SHAPE_TOOLS = new Set(['rect', 'ellipse', 'line']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class BoardEditor {
    constructor({ onChange, onUI, onIdle, onError }) {
        this.onChange = onChange;
        this.onUI = onUI;
        this.onIdle = onIdle;
        this.onError = onError;
        this.history = new History();
        this.title = EMPTY_DOCUMENT.title;
        this.mode = 'select';
        this.color = readPreference('color', document.documentElement.dataset.theme === 'dark' ? '#e7e7ee' : '#292d3e');
        this.strokeWidth = readPreference('stroke', 3);
        this.fontSize = 28;
        this.fillMode = 'none';
        this.space = false;
        this.loading = false;
        this.interacting = false;
        this.panning = null;
        this.gesture = null;
        this.editBase = null;
        registerStickyNote();
        Object.assign(fabric.Object.prototype, {
            transparentCorners: false, cornerColor: '#ffffff', cornerStrokeColor: '#7762e8',
            borderColor: '#7762e8', cornerSize: 9, padding: 4,
            borderScaleFactor: 1.5, cornerStyle: 'circle',
        });
        this.canvas = new fabric.Canvas('board', {
            preserveObjectStacking: true, selectionColor: '#7762e818',
            selectionBorderColor: '#7762e8', selectionLineWidth: 1,
            stopContextMenu: true, fireRightClick: false, renderOnAddRemove: false,
            allowTouchScrolling: false,
        });
        this.container = document.getElementById('board-container');
        this.resize();
        const viewport = readPreference('viewport', null);
        if (Array.isArray(viewport) && viewport.length === 6 && viewport.every(Number.isFinite)
            && viewport[0] >= .1 && viewport[0] <= 5) this.canvas.setViewportTransform(viewport);
        this.baseline = this.snapshot();
        this.bindCanvas();
        this.bindNavigation();
        this.setMode('select');
        this.updateViewport();
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('blur', () => {
            this.space = false;
            this.endPan();
        });
    }

    get busy() {
        return this.loading || this.interacting || Boolean(this.panning || this.gesture || this.editBase);
    }

    get editing() {
        return Boolean(this.canvas.getActiveObject()?.isEditing);
    }

    snapshot() {
        const serialized = this.canvas.toJSON(SERIALIZED_PROPERTIES);
        return { schemaVersion: 1, title: this.title, objects: serialized.objects,
            revision: this.baseline?.revision || 0 };
    }

    resize() {
        this.canvas.setDimensions({ width: window.innerWidth, height: window.innerHeight });
        this.canvas.calcOffset();
        this.canvas.requestRenderAll();
    }

    async load(document) {
        const current = this.snapshot();
        if (!hasChanges(diff(current, document))) {
            this.baseline.revision = document.revision;
            return;
        }
        this.loading = true;
        this.canvas.discardActiveObject();
        try {
            await new Promise(resolve => this.canvas.loadFromJSON({ objects: document.objects }, resolve));
            this.title = document.title;
            this.baseline = this.snapshot();
            this.baseline.revision = document.revision;
            this.configureMode();
            this.canvas.requestRenderAll();
        } finally {
            this.loading = false;
            this.emitUI();
        }
    }

    commit({ history = true } = {}) {
        if (this.loading) return;
        const next = this.snapshot();
        const change = diff(this.baseline, next);
        if (hasChanges(change)) {
            if (history) this.history.record(change);
            this.baseline = next;
            this.onChange(mutationFromChange(change), next);
        }
        this.canvas.requestRenderAll();
        this.emitUI();
    }

    emitUI() {
        this.onUI?.({ mode: this.mode, count: this.canvas.size(),
            undo: this.history.past.length > 0, redo: this.history.future.length > 0,
            selected: this.canvas.getActiveObjects(), color: this.color,
            strokeWidth: this.strokeWidth, fontSize: this.fontSize, fillMode: this.fillMode, title: this.title });
    }

    async travel(direction) {
        if (this.editing) this.canvas.getActiveObject().exitEditing();
        if (this.busy) return;
        const mutation = this.history[direction]();
        if (!mutation) return;
        const next = applyMutation(this.snapshot(), mutation);
        await this.load(next);
        this.onChange(mutation, this.snapshot());
        this.emitUI();
    }

    setTitle(title) {
        this.title = title.trim().slice(0, 100) || 'Моя доска';
        this.commit();
    }

    setMode(mode) {
        if (this.loading) return;
        if (this.editing) this.canvas.getActiveObject().exitEditing();
        this.mode = mode;
        if (mode !== 'select') this.canvas.discardActiveObject();
        this.configureMode();
        this.emitUI();
    }

    configureMode() {
        const selectable = this.mode === 'select' && !this.space && !this.panning;
        this.canvas.isDrawingMode = this.mode === 'draw' && !this.space && !this.panning && !this.gesture;
        this.canvas.selection = selectable;
        this.canvas.skipTargetFind = this.mode !== 'select' && this.mode !== 'erase';
        this.canvas.forEachObject(object => { object.selectable = selectable; object.evented = true; });
        this.canvas.defaultCursor = this.mode === 'hand' || this.space ? 'grab'
            : this.mode === 'select' ? 'default' : this.mode === 'text' ? 'text' : 'crosshair';
        this.canvas.hoverCursor = this.mode === 'select' ? 'move' : this.canvas.defaultCursor;
        this.canvas.freeDrawingBrush.color = this.color;
        this.canvas.freeDrawingBrush.width = this.strokeWidth;
        this.canvas.setCursor(this.canvas.defaultCursor);
        this.canvas.requestRenderAll();
    }

    addObject(object) {
        object.set({ id: uid(), order: this.nextOrder(), selectable: this.mode === 'select' });
        this.canvas.add(object);
        return object;
    }

    nextOrder() {
        return Math.max(0, ...this.canvas.getObjects().map(object => object.order || 0)) + 1;
    }

    bindCanvas() {
        this.canvas.on('path:created', ({ path }) => {
            if (this.loading) return;
            path.set({ id: uid(), order: this.nextOrder() });
            this.commit();
        });
        this.canvas.on('object:modified', () => this.commit());
        this.canvas.on('selection:created', () => this.selectionChanged());
        this.canvas.on('selection:updated', () => this.selectionChanged());
        this.canvas.on('selection:cleared', () => this.emitUI());
        this.canvas.on('text:editing:entered', () => {
            if (!this.editBase) this.editBase = this.snapshot();
        });
        this.canvas.on('text:changed', () => this.commit({ history: false }));
        this.canvas.on('text:editing:exited', ({ target }) => {
            if (!this.editBase || this.loading) return;
            if (!target.text.trim()) this.canvas.remove(target);
            const change = diff(this.editBase, this.snapshot());
            this.history.record(change);
            this.editBase = null;
            this.commit({ history: false });
            this.onIdle?.();
        });
        this.canvas.on('mouse:down', options => {
            if (this.loading || options.e.button > 0 || this.panning || this.gesture) return;
            this.interacting = true;
            const pointer = this.canvas.getPointer(options.e);
            if (this.mode === 'erase') {
                if (options.target) this.canvas.remove(options.target);
            } else if (this.mode === 'text' || this.mode === 'sticky') {
                this.addText(pointer, this.mode === 'sticky');
            } else if (SHAPE_TOOLS.has(this.mode)) {
                this.shapeStart = pointer;
                const base = { left: pointer.x, top: pointer.y, stroke: this.color,
                    strokeWidth: this.strokeWidth, strokeUniform: true, fill: this.shapeFill(),
                    originX: 'left', originY: 'top', selectable: false };
                this.shape = this.addObject(this.mode === 'rect'
                    ? new fabric.Rect({ ...base, width: 1, height: 1, rx: 8, ry: 8 })
                    : this.mode === 'ellipse' ? new fabric.Ellipse({ ...base, rx: 1, ry: 1 })
                    : new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], { ...base, fill: null }));
            }
        });
        this.canvas.on('mouse:move', options => {
            if (!this.interacting || this.panning || this.gesture) return;
            if (this.mode === 'erase' && options.target) {
                this.canvas.remove(options.target);
                this.canvas.requestRenderAll();
            }
            if (!this.shape) return;
            const pointer = this.canvas.getPointer(options.e);
            const { x, y } = this.shapeStart;
            let width = Math.abs(pointer.x - x), height = Math.abs(pointer.y - y);
            if (options.e.shiftKey && this.mode !== 'line') width = height = Math.max(width, height);
            const left = pointer.x < x ? x - width : x;
            const top = pointer.y < y ? y - height : y;
            if (this.mode === 'line') {
                let endX = pointer.x, endY = pointer.y;
                if (options.e.shiftKey) {
                    const angle = Math.round(Math.atan2(endY - y, endX - x) / (Math.PI / 4)) * Math.PI / 4;
                    const length = Math.hypot(endX - x, endY - y);
                    endX = x + Math.cos(angle) * length;
                    endY = y + Math.sin(angle) * length;
                }
                this.shape.set({ x2: endX, y2: endY });
            } else if (this.mode === 'ellipse') this.shape.set({ left, top, rx: width / 2, ry: height / 2 });
            else this.shape.set({ left, top, width, height });
            this.canvas.requestRenderAll();
        });
        this.canvas.on('mouse:up', () => {
            if (!this.interacting) return;
            this.interacting = false;
            if (this.shape) {
                const shape = this.shape;
                if (shape.getScaledWidth() < 6 && shape.getScaledHeight() < 6) {
                    if (this.mode === 'line') shape.set({ x2: shape.x1 + 160, y2: shape.y1 });
                    else if (this.mode === 'ellipse') shape.set({ rx: 90, ry: 60 });
                    else shape.set({ width: 180, height: 120 });
                }
                shape.setCoords();
                this.shape = null;
                this.commit();
                this.setMode('select');
                this.canvas.setActiveObject(shape);
            } else if (this.mode === 'erase') this.commit();
            this.onIdle?.();
        });
    }

    selectionChanged() {
        const object = this.canvas.getActiveObjects()[0];
        if (object) {
            const color = TEXT_TYPES.has(object.type) ? object.fill : object.stroke;
            if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) this.color = color;
            if (object.strokeWidth && !TEXT_TYPES.has(object.type)) this.strokeWidth = object.strokeWidth;
            if (object.fontSize) this.fontSize = object.fontSize;
            if (['rect', 'ellipse', 'circle', 'triangle'].includes(object.type)) {
                this.fillMode = !object.fill || object.fill === 'transparent' ? 'none'
                    : typeof object.fill === 'string' && object.fill.length === 9 ? 'soft' : 'solid';
            }
        }
        this.configureMode();
        this.emitUI();
    }

    addText(point = this.center(), sticky = false, text) {
        if (this.loading) return;
        this.setMode('select');
        this.editBase = this.snapshot();
        const TextClass = sticky ? fabric.StickyNote : fabric.Textbox;
        const object = this.addObject(new TextClass(text ?? (sticky ? 'Новая идея' : 'Текст'), {
            left: point.x, top: point.y, width: sticky ? 240 : 280,
            fontFamily: 'Arial', fontSize: sticky ? 20 : this.fontSize,
            lineHeight: 1.35, fill: sticky ? '#665329' : this.color,
            backgroundColor: sticky ? '#fff0ac' : '', padding: 5,
            splitByGrapheme: true, kind: sticky ? 'sticky' : 'text',
            shadow: sticky ? new fabric.Shadow({ color: '#80672618', blur: 18, offsetY: 6 }) : null,
        }));
        this.canvas.setActiveObject(object);
        object.enterEditing();
        object.selectAll();
        this.commit({ history: false });
        return object;
    }

    shapeFill() {
        return this.fillMode === 'solid' ? this.color : this.fillMode === 'soft' ? `${this.color}18` : 'transparent';
    }

    setColor(color) {
        this.color = color;
        writePreference('color', color);
        this.canvas.freeDrawingBrush.color = color;
        this.canvas.getActiveObjects().forEach(object => {
            if (object.type === 'image') return;
            if (TEXT_TYPES.has(object.type)) object.set('fill', color);
            else {
                object.set('stroke', color);
                if (SHAPE_TOOLS.has(object.type) && object.fill && object.fill !== 'transparent') {
                    object.set('fill', this.shapeFill());
                }
            }
        });
        this.commit({ history: !this.editing });
    }

    setStroke(width) {
        this.strokeWidth = width;
        writePreference('stroke', width);
        this.canvas.freeDrawingBrush.width = width;
        this.canvas.getActiveObjects().forEach(object => {
            if (!TEXT_TYPES.has(object.type) && object.type !== 'image') object.set('strokeWidth', width);
        });
        this.commit();
    }

    setFontSize(size) {
        this.fontSize = size;
        this.canvas.getActiveObjects().forEach(object => {
            if (TEXT_TYPES.has(object.type)) object.set('fontSize', size);
        });
        this.commit({ history: !this.editing });
    }

    setFill(mode) {
        this.fillMode = mode;
        this.canvas.getActiveObjects().forEach(object => {
            if (['rect', 'ellipse', 'circle', 'triangle'].includes(object.type)) object.set('fill', this.shapeFill());
        });
        this.commit();
    }

    removeSelected() {
        if (this.editing) this.canvas.getActiveObject().exitEditing();
        if (this.busy || this.editing) return;
        const objects = this.canvas.getActiveObjects();
        this.canvas.discardActiveObject();
        objects.forEach(object => this.canvas.remove(object));
        this.commit();
    }

    async duplicate() {
        if (this.editing) this.canvas.getActiveObject().exitEditing();
        if (this.busy || !this.canvas.getActiveObjects().length) return;
        const source = this.canvas.getActiveObject();
        const clone = await new Promise(resolve => source.clone(resolve, SERIALIZED_PROPERTIES));
        this.canvas.discardActiveObject();
        clone.set({ left: clone.left + 24, top: clone.top + 24 });
        if (clone.type === 'activeSelection') {
            clone.canvas = this.canvas;
            clone.forEachObject(object => this.addObject(object));
            clone.setCoords();
        } else this.addObject(clone);
        this.canvas.setActiveObject(clone);
        this.commit();
    }

    copySelection() {
        const ids = new Set(this.canvas.getActiveObjects().map(object => object.id));
        return this.snapshot().objects.filter(object => ids.has(object.id));
    }

    async pasteObjects(objects) {
        if (this.busy || !objects.length) return;
        if (this.canvas.size() + objects.length > 3000) throw new Error('На доске может быть не более 3000 объектов.');
        const copies = await new Promise(resolve => fabric.util.enlivenObjects(objects, resolve));
        this.setMode('select');
        this.canvas.discardActiveObject();
        copies.forEach(object => {
            object.set({ left: object.left + 24, top: object.top + 24 });
            this.addObject(object);
        });
        this.canvas.setActiveObject(copies.length === 1 ? copies[0] : new fabric.ActiveSelection(copies, { canvas: this.canvas }));
        this.commit();
    }

    nudge(x, y) {
        if (this.busy) return;
        const object = this.canvas.getActiveObject();
        if (!object) return;
        object.set({ left: object.left + x, top: object.top + y });
        object.setCoords();
        this.commit();
    }

    selectAll() {
        if (this.busy) return;
        this.setMode('select');
        this.canvas.discardActiveObject();
        const objects = this.canvas.getObjects();
        if (objects.length === 1) this.canvas.setActiveObject(objects[0]);
        else if (objects.length) this.canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas: this.canvas }));
        this.canvas.requestRenderAll();
    }

    clear() {
        if (this.busy) return;
        this.canvas.discardActiveObject();
        this.canvas.remove(...this.canvas.getObjects());
        this.commit();
    }

    async replace(document) {
        const previous = this.snapshot();
        // New IDs make importing the same export an independent, undoable action.
        const next = { ...document, objects: document.objects.map((object, index) => ({ ...object, id: uid(), order: index })) };
        await this.load(next);
        const change = diff(previous, this.snapshot());
        this.history.record(change);
        this.onChange(mutationFromChange(change), this.snapshot());
        this.fit();
        this.emitUI();
    }

    async addImage(file, point) {
        if (!file || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
            throw new Error('Выберите изображение PNG, JPG, WebP или GIF.');
        }
        if (file.size > 5 * 1024 * 1024) throw new Error('Размер изображения должен быть меньше 5 МБ.');
        const source = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
            reader.readAsDataURL(file);
        });
        const image = await new Promise((resolve, reject) => {
            fabric.Image.fromURL(source, (object, error) => error ? reject(new Error('Не удалось открыть изображение.')) : resolve(object));
        });
        if (image.width * image.height > 40_000_000) throw new Error('Изображение слишком большое: максимум 40 мегапикселей.');
        const scale = Math.min(1, 600 / image.width, 500 / image.height);
        image.scale(scale);
        const center = point || this.center();
        image.set({ left: center.x - image.getScaledWidth() / 2, top: center.y - image.getScaledHeight() / 2 });
        this.setMode('select');
        this.addObject(image);
        this.canvas.setActiveObject(image);
        this.commit();
    }

    center() {
        const transform = this.canvas.viewportTransform;
        return { x: (this.canvas.width / 2 - transform[4]) / transform[0],
            y: (this.canvas.height / 2 - transform[5]) / transform[0] };
    }

    updateViewport() {
        const transform = this.canvas.viewportTransform;
        const zoom = this.canvas.getZoom();
        // At small zoom levels use a coarser grid instead of rendering a solid field.
        const spacing = zoom < .4 ? 96 : zoom < .75 ? 48 : 24;
        this.container.style.setProperty('--grid-size', `${spacing * zoom}px`);
        this.container.style.setProperty('--grid-offset-x', `${transform[4]}px`);
        this.container.style.setProperty('--grid-offset-y', `${transform[5]}px`);
        document.getElementById('zoom-reset').textContent = `${Math.round(zoom * 100)}%`;
        writePreference('viewport', [...transform]);
    }

    zoom(value, point = new fabric.Point(this.canvas.width / 2, this.canvas.height / 2)) {
        this.canvas.zoomToPoint(point, clamp(value, .1, 5));
        this.canvas.requestRenderAll();
        this.updateViewport();
    }

    fit() {
        const objects = this.canvas.getObjects();
        if (!objects.length) {
            this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            this.updateViewport();
            return;
        }
        this.canvas.discardActiveObject();
        const bounds = objects.map(object => object.getBoundingRect(true, true));
        const left = Math.min(...bounds.map(box => box.left));
        const top = Math.min(...bounds.map(box => box.top));
        const right = Math.max(...bounds.map(box => box.left + box.width));
        const bottom = Math.max(...bounds.map(box => box.top + box.height));
        const mobile = this.canvas.width <= 700;
        const inset = { left: mobile ? 30 : 84, right: mobile ? 30 : 208, top: mobile ? 340 : 150, bottom: mobile ? 160 : 100 };
        const width = Math.max(100, this.canvas.width - inset.left - inset.right);
        const height = Math.max(100, this.canvas.height - inset.top - inset.bottom);
        const zoom = clamp(Math.min(width / Math.max(1, right - left), height / Math.max(1, bottom - top), 1.5), .1, 5);
        this.canvas.setViewportTransform([zoom, 0, 0, zoom,
            inset.left + width / 2 - (left + right) / 2 * zoom,
            inset.top + height / 2 - (top + bottom) / 2 * zoom]);
        this.canvas.requestRenderAll();
        this.updateViewport();
    }

    bindNavigation() {
        const upper = this.canvas.upperCanvasEl;
        upper.addEventListener('contextmenu', event => event.preventDefault());
        upper.addEventListener('mousedown', event => {
            if (this.loading) return;
            if (event.button === 2 || event.button === 1 || this.space || this.mode === 'hand') {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (this.editing) this.canvas.getActiveObject().exitEditing();
                this.startPan(event.clientX, event.clientY);
            }
        }, true);
        document.addEventListener('mousemove', event => {
            if (!this.panning) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.movePan(event.clientX, event.clientY);
        }, true);
        document.addEventListener('mouseup', event => {
            if (!this.panning) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.endPan();
        }, true);
        this.canvas.on('mouse:wheel', ({ e }) => {
            e.preventDefault();
            e.stopPropagation();
            this.zoom(this.canvas.getZoom() * .998 ** e.deltaY, new fabric.Point(e.offsetX, e.offsetY));
        });
        upper.addEventListener('touchstart', event => {
            if (event.touches.length === 2) {
                event.preventDefault();
                event.stopImmediatePropagation();
                this.cancelStroke();
                if (this.editing) this.canvas.getActiveObject().exitEditing();
                const [a, b] = event.touches;
                const midpoint = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
                const transform = [...this.canvas.viewportTransform];
                this.gesture = { distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
                    zoom: transform[0], worldX: (midpoint.x - transform[4]) / transform[0],
                    worldY: (midpoint.y - transform[5]) / transform[0] };
                this.configureMode();
            } else if (event.touches.length === 1 && this.mode === 'hand') {
                event.preventDefault();
                event.stopImmediatePropagation();
                this.startPan(event.touches[0].clientX, event.touches[0].clientY);
            }
        }, { capture: true, passive: false });
        upper.addEventListener('touchmove', event => {
            if (this.gesture) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (event.touches.length !== 2) return;
                const [a, b] = event.touches;
                const zoom = clamp(this.gesture.zoom * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / this.gesture.distance, .1, 5);
                this.canvas.setViewportTransform([zoom, 0, 0, zoom,
                    (a.clientX + b.clientX) / 2 - this.gesture.worldX * zoom,
                    (a.clientY + b.clientY) / 2 - this.gesture.worldY * zoom]);
                this.canvas.requestRenderAll();
                this.updateViewport();
            } else if (this.panning && event.touches.length === 1) {
                event.preventDefault();
                event.stopImmediatePropagation();
                this.movePan(event.touches[0].clientX, event.touches[0].clientY);
            }
        }, { capture: true, passive: false });
        const endTouch = event => {
            if (!this.gesture && !this.panning) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.touches.length) return;
            this.gesture = null;
            this.endPan();
            this.interacting = false;
            this.configureMode();
            this.onIdle?.();
        };
        document.addEventListener('touchend', endTouch, { capture: true, passive: false });
        document.addEventListener('touchcancel', endTouch, { capture: true, passive: false });
    }

    cancelStroke() {
        // Fabric's active stroke lives on the overlay until it becomes an object.
        this.canvas._isCurrentlyDrawing = false;
        this.canvas._currentTransform = null;
        this.canvas.clearContext(this.canvas.contextTop);
        if (this.shape) { this.canvas.remove(this.shape); this.shape = null; }
        this.interacting = false;
    }

    startPan(x, y) {
        this.cancelStroke();
        this.panning = { x, y };
        this.canvas.isDrawingMode = false;
        this.canvas.selection = false;
        this.canvas.setCursor('grabbing');
    }

    movePan(x, y) {
        const transform = [...this.canvas.viewportTransform];
        transform[4] += x - this.panning.x;
        transform[5] += y - this.panning.y;
        this.panning = { x, y };
        this.canvas.setViewportTransform(transform);
        this.canvas.setCursor('grabbing');
        this.canvas.requestRenderAll();
        this.updateViewport();
    }

    endPan() {
        if (!this.panning) return;
        this.panning = null;
        this.configureMode();
        this.onIdle?.();
    }

    setSpace(pressed) {
        this.space = pressed;
        this.configureMode();
    }

    async exportPNG() {
        if (!this.canvas.size()) throw new Error('Добавьте что-нибудь на доску перед экспортом.');
        const copy = new fabric.StaticCanvas(null, { enableRetinaScaling: false, renderOnAddRemove: false });
        try {
            await new Promise(resolve => copy.loadFromJSON({ objects: this.snapshot().objects }, resolve));
            const boxes = copy.getObjects().map(object => object.getBoundingRect(true, true));
            const left = Math.min(...boxes.map(box => box.left)) - 40;
            const top = Math.min(...boxes.map(box => box.top)) - 40;
            const width = Math.max(...boxes.map(box => box.left + box.width)) - left + 40;
            const height = Math.max(...boxes.map(box => box.top + box.height)) - top + 40;
            const scale = Math.min(2, 6000 / width, 6000 / height, Math.sqrt(16000000 / (width * height)));
            copy.setDimensions({ width: Math.ceil(width * scale), height: Math.ceil(height * scale) });
            copy.setViewportTransform([scale, 0, 0, scale, -left * scale, -top * scale]);
            copy.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
            copy.renderAll();
            return await new Promise((resolve, reject) => copy.lowerCanvasEl.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось создать PNG.')), 'image/png'));
        } finally { copy.dispose(); }
    }

}
