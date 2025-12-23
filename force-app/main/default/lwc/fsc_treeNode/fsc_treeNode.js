import { LightningElement, api, track } from 'lwc';

export default class Fsc_treeNode extends LightningElement {
    @api node;
    @track expanded = false;

    connectedCallback() {
        this.expanded = this.node?.expanded || false;
    }

    get hasChildren() {
        return this.node?.items && this.node.items.length > 0;
    }

    // Replace ternary in template with a getter
    get toggleSymbol() {
        return this.expanded ? '▼' : '▶';
    }

    toggleExpand(event) {
        event.stopPropagation(); // prevent parent click
        this.expanded = !this.expanded;
    }

    handleClick() {
        this.dispatchEvent(new CustomEvent('nodeclick', { detail: this.node }));
    }
}