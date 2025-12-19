import { LightningElement, api, track } from 'lwc';

export default class ReviewForm extends LightningElement {
    // Received from parent: { sections: [{ name, fields: [{ fieldApiName, fieldType, value, isText, isTextArea, isNumber, isDate, isDateTime, isCheckbox, isPicklist, isOther, comboboxOptions }] }] }
    @api reviewJson;

    @track open = false;
    @track localEditable; // deep cloned editable copy

    connectedCallback() {
        // If parent pre-set reviewJson, initialize local state
        if (this.reviewJson) {
            this.initializeState(this.reviewJson);
        }
    }

    @api
    openPanel() {
        // Explicit API the parent can call after setting reviewJson
        this.initializeState(this.reviewJson);
    }

    initializeState(src) {
        try {
            // Defensive deep clone to avoid mutating parent's object until overwrite is confirmed
            const cloned = src ? JSON.parse(JSON.stringify(src)) : { sections: [] };
            this.localEditable = cloned;
            this.open = true;
            // Logs for visibility
            // Parent -> Child JSON
            // eslint-disable-next-line no-console
            console.log('Child received review JSON', JSON.stringify(src));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('Failed to initialize child state', e);
            this.localEditable = { sections: [] };
            this.open = true;
        }
    }

    closePanel() {
        this.open = false;
    }

    // Handle input changes and update localEditable in-place
    handleFieldChange(event) {
        const fieldName = event.target.dataset.fieldName;
        const sectionName = event.target.dataset.sectionName;
        let newValue;

        if (event.target.type === 'checkbox') {
            newValue = event.target.checked;
        } else {
            newValue = event.detail?.value ?? event.target.value;
        }

        const section = this.localEditable.sections.find(s => s.name === sectionName);
        if (!section) return;

        const field = section.fields.find(f => f.fieldApiName === fieldName);
        if (!field) return;

        field.value = newValue;

        // Log on each change (can be verbose; keep for POC)
        // eslint-disable-next-line no-console
        console.log('Child updated JSON (partial change)', JSON.stringify(this.localEditable));
    }

    handleOverwrite() {
        // Log the final JSON and dispatch event to parent
        // eslint-disable-next-line no-console
        console.log('Child submitting updated JSON', JSON.stringify(this.localEditable));

        this.dispatchEvent(new CustomEvent('reviewoverwrite', {
            detail: JSON.parse(JSON.stringify(this.localEditable)), // send a clean copy
            bubbles: true,
            composed: true
        }));
        this.closePanel();
    }

    handleKeep() {
        // eslint-disable-next-line no-console
        console.log('Child keep as is requested');

        this.dispatchEvent(new CustomEvent('reviewkeep', {
            bubbles: true,
            composed: true
        }));
        this.closePanel();
    }
}
