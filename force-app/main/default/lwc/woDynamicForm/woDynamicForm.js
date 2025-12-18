import { LightningElement, api, track, wire } from 'lwc';
import { gql, graphql } from 'lightning/uiGraphQLApi';

const GENERIC_FORM_FIELDS_QUERY = gql`
  query loadGenericForm {
    uiapi {
      query {
        Generic_Form__mdt {
          edges {
            node {
              Asset_Attribute__c {
                value
              }
              Asset_Type__c {
                value
              }
              Picklist_Values__c {
                value
              }
              Section__c {
                value
              }
            }
          }
        }
      }
    }
  }
`;

export default class WoDynamicForm extends LightningElement {
    @api recordId;
    @api objectApiName;

    @track sections = [];
    @track loading = true;
    @track saving = false;
    @track schemaError;

    /* -------------------------------
       Load Dynamic Schema (GraphQL -> Generic_Form__mdt)
    ------------------------------- */
    @wire(graphql, { query: GENERIC_FORM_FIELDS_QUERY })
    wiredForm({ data, errors }) {
        if (!data && !errors) return;

        try {
            console.log('Try Data', data);
            if (errors && errors.length) {
                // GraphQL surfaced errors
                this.schemaError = errors.map(e => e.message).join('; ');
                this.sections = [];
                this.loading = false;
                return;
            }

            const edges = data?.uiapi?.query?.Generic_Form__mdt?.edges || [];
            const grouped = new Map();

            edges.forEach(edge => {
                const node = edge?.node;
                if (!node) return;

                const sectionName = node?.Section__c?.value || 'Other';
                if (!grouped.has(sectionName)) {
                    grouped.set(sectionName, []);
                }

                const label = node?.Asset_Attribute__c?.value;
                const typeRaw = (node?.Asset_Type__c?.value || '').toLowerCase();

                const isText = ['text', 'string'].includes(typeRaw);
                const isTextArea = ['textarea', 'longtext'].includes(typeRaw);
                const isNumber = ['number', 'double', 'currency', 'percent'].includes(typeRaw);
                const isDate = typeRaw === 'date';
                const isDateTime = typeRaw === 'datetime';
                const isCheckbox = ['checkbox', 'boolean'].includes(typeRaw);
                const isPicklist = typeRaw === 'picklist';

                const isOther =
                    !isText &&
                    !isTextArea &&
                    !isNumber &&
                    !isDate &&
                    !isDateTime &&
                    !isCheckbox &&
                    !isPicklist;

                // Build picklist options from comma-separated values
                let comboboxOptions = [];
                if (isPicklist) {
                    const raw = node?.Picklist_Values__c?.value || '';
                    comboboxOptions = raw
                        .split(',')
                        .map(s => s.trim())
                        .filter(s => s.length)
                        .map(v => ({ label: v, value: v }));
                }

                grouped.get(sectionName).push({
                    section: sectionName,
                    fieldApiName: label, // using provided attribute label as display/key
                    fieldType: typeRaw,
                    comboboxOptions,

                    isText,
                    isTextArea,
                    isNumber,
                    isDate,
                    isDateTime,
                    isCheckbox,
                    isPicklist,
                    isOther,

                    value: null
                });
            });

            this.sections = Array.from(grouped.entries(), ([name, fields]) => ({ name, fields }));
            this.schemaError = undefined;
        } catch (e) {
            this.schemaError = e?.message;
            this.sections = [];
            console.log('Catch Error',e);
        } finally {
            this.loading = false;
        }
    }

    get hasSections() {
        return this.sections.length > 0;
    }

    /* -------------------------------
       Build Asset Update Model
    ------------------------------- */
    get assetFieldModel() {
        const model = {};
        this.sections.forEach(sec => {
            sec.fields.forEach(field => {
                const el = this.template.querySelector(`[data-field-name="${field.fieldApiName}"]`);
                if (!el) return;

                let val = el.value;
                if (el.type === 'checkbox') {
                    val = el.checked;
                }
                model[field.fieldApiName] = val;
            });
        });
        return model;
    }

    /* -------------------------------
       Save Handler
    ------------------------------- */
    async handleSave() {
        try {
            this.saving = true;

            // Save Work Order
            const form = this.template.querySelector('lightning-record-edit-form[data-form="wo"]');
            const woSaved = form ? await this.submitEditForm(form) : false;

            // Save Asset
            let assetSaved = false;
            const hasAssetFields = this.sections.some(s => s.fields.length > 0);

            if (this.assetRecordId && hasAssetFields) {
                const fields = { Id: this.assetRecordId, ...this.assetFieldModel };
                await updateRecord({ fields });
                assetSaved = true;
            }

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Saved',
                    message: this.buildSaveMsg(woSaved, assetSaved),
                    variant: 'success'
                })
            );

        } catch (e) {
            console.error('Save error:', e);
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Save failed',
                    message: e?.body?.message || e?.message,
                    variant: 'error',
                    mode: 'sticky'
                })
            );
        } finally {
            this.saving = false;
        }
    }

    buildSaveMsg(wo, asset) {
        if (wo && asset) return 'Work Order & Asset saved.';
        if (wo) return 'Work Order saved.';
        if (asset) return 'Asset saved.';
        return 'No changes.';
    }

    /* -------------------------------
       Submit wrapper for LDS Form
    ------------------------------- */
    submitEditForm(form) {
        return new Promise(resolve => {
            const ok = () => { cleanup(); resolve(true); };
            const fail = () => { cleanup(); resolve(false); };

            const cleanup = () => {
                form.removeEventListener('success', ok);
                form.removeEventListener('error', fail);
            };

            form.addEventListener('success', ok);
            form.addEventListener('error', fail);

            form.submit();
        });
    }
}