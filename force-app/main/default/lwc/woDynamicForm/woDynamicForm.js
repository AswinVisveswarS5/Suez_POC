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
              Section_Order__c {
                value
              }
              Field_Order__c {
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

    // Review child panel state
    @track showReview = false;
    @track reviewPayload;
    @track showKeepEmoji = false;

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
                const sectionOrder = Number(node?.Section_Order__c?.value ?? Number.POSITIVE_INFINITY);
                if (!grouped.has(sectionName)) {
                    grouped.set(sectionName, { order: sectionOrder, fields: [] });
                } else {
                    // If multiple nodes provide different section order numbers for same section, keep the lowest
                    const existing = grouped.get(sectionName);
                    const newOrder = Math.min(existing.order ?? Number.POSITIVE_INFINITY, sectionOrder);
                    existing.order = newOrder;
                }

                const label = node?.Asset_Attribute__c?.value;
                const typeRaw = (node?.Asset_Type__c?.value || '').toLowerCase();
                const fieldOrder = Number(node?.Field_Order__c?.value ?? Number.POSITIVE_INFINITY);

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

                const fieldDef = {
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

                    value: null,
                    fieldOrder: isNaN(fieldOrder) ? Number.POSITIVE_INFINITY : fieldOrder
                };

                grouped.get(sectionName).fields.push(fieldDef);
            });

            // Sort fields within each section: by Field_Order__c asc, then alphabetical by fieldApiName
            for (const [name, entry] of grouped.entries()) {
                entry.fields.sort((a, b) => {
                    const ao = a.fieldOrder ?? Number.POSITIVE_INFINITY;
                    const bo = b.fieldOrder ?? Number.POSITIVE_INFINITY;
                    if (ao !== bo) return ao - bo;
                    const an = (a.fieldApiName || '').toString().toLowerCase();
                    const bn = (b.fieldApiName || '').toString().toLowerCase();
                    if (an < bn) return -1;
                    if (an > bn) return 1;
                    return 0;
                });
            }

            // Build and sort sections: by Section_Order__c asc, then alphabetical by section name
            const sectionList = Array.from(grouped.entries(), ([name, entry]) => ({
                name,
                fields: entry.fields,
                sectionOrder: isNaN(entry.order) ? Number.POSITIVE_INFINITY : entry.order
            }));

            sectionList.sort((a, b) => {
                const ao = a.sectionOrder ?? Number.POSITIVE_INFINITY;
                const bo = b.sectionOrder ?? Number.POSITIVE_INFINITY;
                if (ao !== bo) return ao - bo;
                const an = (a.name || '').toString().toLowerCase();
                const bn = (b.name || '').toString().toLowerCase();
                if (an < bn) return -1;
                if (an > bn) return 1;
                return 0;
            });

            this.sections = sectionList;
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

    // Build the full review JSON payload from current UI state
    buildReviewPayload() {
        const payload = {
            sections: this.sections.map(sec => {
                return {
                    name: sec.name,
                    fields: sec.fields.map(f => {
                        const el = this.template.querySelector(`[data-field-name="${f.fieldApiName}"]`);
                        let val = f.value ?? null;
                        if (el) {
                            val = el.type === 'checkbox' ? el.checked : (el.value ?? el?.dataset?.value ?? null);
                        }
                        return {
                            section: f.section,
                            fieldApiName: f.fieldApiName,
                            fieldType: f.fieldType,
                            comboboxOptions: f.comboboxOptions,
                            isText: f.isText,
                            isTextArea: f.isTextArea,
                            isNumber: f.isNumber,
                            isDate: f.isDate,
                            isDateTime: f.isDateTime,
                            isCheckbox: f.isCheckbox,
                            isPicklist: f.isPicklist,
                            isOther: f.isOther,
                            value: val
                        };
                    })
                };
            })
        };

        // Console for visibility (as requested)
        // eslint-disable-next-line no-console
        console.log('Parent sending review JSON', JSON.stringify(payload));
        return payload;
    }

    // Open child review with JSON
    handleSendInfo = () => {
        this.showKeepEmoji = false; // reset tick on new review
        this.reviewPayload = this.buildReviewPayload();
        this.showReview = true;
    };

    // Handle overwrite from child - apply values back to inputs/state
    handleReviewOverwrite = (evt) => {
        const updated = evt?.detail;
        // eslint-disable-next-line no-console
        console.log('Parent received updated JSON from child', JSON.stringify(updated));

        if (!updated?.sections) {
            this.showReview = false;
            return;
        }

        // Apply values back into the visible inputs
        updated.sections.forEach(sec => {
            sec.fields.forEach(f => {
                const el = this.template.querySelector(`[data-field-name="${f.fieldApiName}"]`);
                if (!el) return;
                if (el.type === 'checkbox') {
                    el.checked = !!f.value;
                } else {
                    el.value = f.value;
                }
            });
        });

        // Optionally update local sections model values too
        this.sections = this.sections.map(sec => {
            const incomingSec = updated.sections.find(s => s.name === sec.name);
            if (!incomingSec) return sec;
            const newFields = sec.fields.map(f => {
                const incomingField = incomingSec.fields.find(x => x.fieldApiName === f.fieldApiName);
                if (!incomingField) return f;
                return { ...f, value: incomingField.value };
            });
            return { ...sec, fields: newFields };
        });

        this.showReview = false;
        this.showKeepEmoji = false;
    };

    // Handle keep from child - close child and show tick
    handleReviewKeep = () => {
        // eslint-disable-next-line no-console
        console.log('Parent keep as is: no overwrite performed');
        this.showReview = false;
        this.showKeepEmoji = true;
    };

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