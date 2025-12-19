public with sharing class GenericFormMetadataService {
    public class FieldDescriptor {
        @AuraEnabled public String section;
        @AuraEnabled public String fieldApiName; // Asset_Attribute__c
        @AuraEnabled public String fieldType;    // Asset_Type__c (Text, Number, Date, Picklist, etc.)
        @AuraEnabled public List<String> picklistValues; // from Picklist_Values__c
    }

    @AuraEnabled(cacheable=true)
    public static List<FieldDescriptor> getFormSchema() {
        List<FieldDescriptor> result = new List<FieldDescriptor>();

        for (Generic_Form__mdt row : [
            SELECT Section__c, Asset_Type__c, Asset_Attribute__c, Picklist_Values__c
            FROM Generic_Form__mdt
            ORDER BY Section__c, Asset_Attribute__c
        ]) {
            FieldDescriptor fd = new FieldDescriptor();
            fd.section = row.Section__c;
            fd.fieldApiName = row.Asset_Attribute__c;
            fd.fieldType = row.Asset_Type__c;
            // Parse picklist values by newline or semicolon or comma to be flexible
            List<String> vals = new List<String>();
            if (String.isNotBlank(row.Picklist_Values__c)) {
                String src = row.Picklist_Values__c;
                if (src.contains('\n')) {
                    vals = new List<String>(src.split('\\n'));
                } else if (src.contains(';')) {
                    vals = new List<String>(src.split(';'));
                } else if (src.contains(',')) {
                    vals = new List<String>(src.split(','));
                } else {
                    vals = new List<String>{src};
                }
                // trim values
                for (Integer i = 0; i < vals.size(); i++) {
                    vals[i] = vals[i] != null ? vals[i].trim() : null;
                }
                // remove empties (List<String> has no removeAll(list) in Apex)
                for (Integer i = vals.size() - 1; i >= 0; i--) {
                    String v = vals[i];
                    if (v == null || v == '') {
                        vals.remove(i);
                    }
                }
            }
            fd.picklistValues = vals;
            result.add(fd);
        }
        return result;
    }
}
