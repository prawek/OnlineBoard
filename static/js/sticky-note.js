/** A padded, editable note. Its full card is selectable and survives JSON round trips. */
export function registerStickyNote() {
    if (fabric.StickyNote) return;
    fabric.StickyNote = fabric.util.createClass(fabric.Textbox, {
        type: 'sticky-note',
        notePadding: 20,
        minNoteHeight: 180,

        initDimensions() {
            this.callSuper('initDimensions');
            if (!this.__skipDimension) this.height = Math.max(this.minNoteHeight, this.height + this.notePadding * 2);
        },

        _wrapLine(line, lineIndex, desiredWidth, reservedSpace) {
            return this.callSuper('_wrapLine', line, lineIndex,
                Math.max(20, desiredWidth - this.notePadding * 2), reservedSpace);
        },

        _getLeftOffset() {
            return this.callSuper('_getLeftOffset') + this.notePadding;
        },

        _getTopOffset() {
            return this.callSuper('_getTopOffset') + this.notePadding;
        },

        toObject(properties = []) {
            return this.callSuper('toObject', [...properties, 'notePadding', 'minNoteHeight']);
        },
    });
    fabric.StickyNote.fromObject = (object, callback) => {
        const styles = fabric.util.stylesFromArray(object.styles, object.text);
        fabric.Object._fromObject('StickyNote', { ...object, styles }, callback, 'text');
    };
}
