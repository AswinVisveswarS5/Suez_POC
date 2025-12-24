import { LightningElement, api, track, wire } from 'lwc';
import { gql, graphql } from 'lightning/uiGraphQLApi';

/* ===================== QUERY ===================== */
const QUERY = gql`
query loadGenericForm {
  uiapi {
    query {
      Generic_Form__mdt {
        edges {
          node {
            Asset_Attribute__c { value }
            Asset_Type__c { value }
            Picklist_Values__c { value }
            Section__c { value }
            Section_Order__c { value }
            Field_Order__c { value }
            Section_Criteria__c { value }
            Field_Criteria__c { value }
          }
        }
      }
    }
  }
}
`;

/* ===================== CRITERIA REGEX ===================== */
const CRITERIA_REGEX =
/^\s*\[([^\]]+)\]\.\[([^\]]+)\]\s*\{\s*([!<>=]*)(.*?)\s*\}\s*$/;

export default class WoDynamicForm extends LightningElement {

    @api recordId;
    @api objectApiName;

    @track sections = [];
    @track loading = true;
    @track saving = false;
    @track schemaError;

    /* ===================== METADATA LOAD ===================== */
    @wire(graphql, { query: QUERY })
    wiredForm({ data, errors }) {
        try {
            if (errors) {
                this.schemaError = errors.map(e => e.message).join('; ');
                return;
            }

            const edges = data?.uiapi?.query?.Generic_Form__mdt?.edges || [];
            const grouped = new Map();

            edges.forEach(({ node }) => {
                const sectionName = node.Section__c?.value || 'Other';

                if (!grouped.has(sectionName)) {
                    grouped.set(sectionName, {
                        name: sectionName,
                        sectionOrder: Number(node.Section_Order__c?.value ?? 9999),
                        sectionCriteria: node.Section_Criteria__c?.value || '',
                        fields: []
                    });
                }

                const type = (node.Asset_Type__c?.value || '').toLowerCase();
                const isPicklist = type === 'picklist';

                grouped.get(sectionName).fields.push({
                    fieldApiName: node.Asset_Attribute__c?.value,
                    fieldOrder: Number(node.Field_Order__c?.value ?? 9999),
                    fieldCriteria: node.Field_Criteria__c?.value || '',
                    value: null,

                    isText: ['text', 'string'].includes(type),
                    isTextArea: ['textarea', 'longtext'].includes(type),
                    isNumber: ['number', 'double', 'currency', 'percent'].includes(type),
                    isDate: type === 'date',
                    isDateTime: type === 'datetime',
                    isCheckbox: ['checkbox', 'boolean'].includes(type),
                    isPicklist,

                    comboboxOptions: isPicklist
                        ? (node.Picklist_Values__c?.value || '')
                            .split(',')
                            .map(v => ({ label: v.trim(), value: v.trim() }))
                        : []
                });
            });

            let list = Array.from(grouped.values());

            list.forEach(sec => {
                sec.fields.sort((a, b) => a.fieldOrder - b.fieldOrder);
                sec.isVisible = true;
                sec.fields = sec.fields.map(f => ({ ...f, isVisible: true }));
            });

            list.sort((a, b) => a.sectionOrder - b.sectionOrder);

            this.sections = list;

            /* ===== INITIAL JSON LOG ===== */
            console.group('📦 INITIAL FORM JSON');
            console.log(JSON.parse(JSON.stringify(this.sections)));
            console.groupEnd();

            Promise.resolve().then(() => this.reEvaluateVisibility());

        } catch (e) {
            this.schemaError = e.message;
        } finally {
            this.loading = false;
        }
    }

    get hasSections() {
        return this.sections.length > 0;
    }

    /* ===================== INPUT CHANGE ===================== */
    handleChange(event) {
        const fieldName = event.target.dataset.fieldName;
        const value =
            event.target.type === 'checkbox'
                ? event.target.checked
                : event.target.value;

        console.group('✏️ FIELD CHANGE');
        console.log('Field:', fieldName);
        console.log('New Value:', value);
        console.groupEnd();

        this.sections = this.sections.map(sec => ({
            ...sec,
            fields: sec.fields.map(f =>
                f.fieldApiName === fieldName
                    ? { ...f, value }
                    : f
            )
        }));

        this.reEvaluateVisibility();
    }

    /* ===================== VISIBILITY ENGINE ===================== */
    reEvaluateVisibility() {
        console.group('🔄 RE-EVALUATION START');

        this.sections = this.sections.map(sec => {

            const normalizedSectionCriteria = this.normalizeCriteria(sec.sectionCriteria);

            console.group(`📂 SECTION: ${sec.name}`);
            console.log('Section Criteria (raw):', JSON.stringify(sec.sectionCriteria));
            console.log('Section Criteria (normalized):', normalizedSectionCriteria || '(none)');

            const sectionVisible = normalizedSectionCriteria
                ? this.evaluateCriteria(normalizedSectionCriteria)
                : true;

            console.log('➡️ Section Visible:', sectionVisible);

            const fields = sec.fields.map(f => {
                const normalizedFieldCriteria = this.normalizeCriteria(f.fieldCriteria);

                let fieldVisible = false;

                if (sectionVisible) {
                    fieldVisible =
                        !normalizedFieldCriteria ||
                        this.evaluateCriteria(normalizedFieldCriteria);
                }

                console.log(`   📄 FIELD: ${f.fieldApiName}`);
                console.log('      Field Criteria:', normalizedFieldCriteria || '(none)');
                console.log('      Field Value:', f.value);
                console.log('      Field Visible:', fieldVisible);

                return {
                    ...f,
                    isVisible: fieldVisible
                };
            });

            console.groupEnd(); // section

            return {
                ...sec,
                isVisible: sectionVisible,
                renderKey: `${sec.name}-${sectionVisible}`,
                fields
            };
        });

        console.groupEnd(); // re-eval

        console.group('📦 FINAL VISIBILITY STATE');
        console.log(JSON.parse(JSON.stringify(this.sections)));
        console.groupEnd();
    }

    /* ===================== CRITERIA NORMALIZATION ===================== */
    normalizeCriteria(raw) {
        if (raw === null || raw === undefined) {
            return '';
        }
        return String(raw).trim();
    }

    /* ===================== CRITERIA EVALUATION ===================== */
    evaluateCriteria(criteria) {
        console.group('🔍 CRITERIA EVALUATION');
        console.log('Criteria:', criteria);

        const m = criteria.match(CRITERIA_REGEX);
        if (!m) {
            console.warn('❌ Regex did not match');
            console.groupEnd();
            return false;
        }

        const [, sectionName, fieldName, operator, expected] = m;

        const section = this.sections.find(s => s.name === sectionName);
        const field = section?.fields.find(f => f.fieldApiName === fieldName);
        const actual = field?.value;

        console.log('Section:', sectionName);
        console.log('Field:', fieldName);
        console.log('Operator:', operator || '=');
        console.log('Expected:', expected);
        console.log('Actual:', actual);

        if (actual === null || actual === undefined) {
            console.log('➡️ RESULT: FALSE (actual value is null)');
            console.groupEnd();
            return false;
        }

        let result = false;

        if (['>', '<', '>=', '<='].includes(operator)) {
            const a = Number(actual);
            const e = Number(expected);

            if (Number.isNaN(a) || Number.isNaN(e)) {
                console.log('➡️ RESULT: FALSE (NaN)');
                console.groupEnd();
                return false;
            }

            result =
                operator === '>' ? a > e :
                operator === '>=' ? a >= e :
                operator === '<' ? a < e :
                a <= e;
        } else {
            result = String(actual).toLowerCase() === expected.toLowerCase();
        }

        console.log('➡️ RESULT:', result);
        console.groupEnd();
        return result;
    }
}