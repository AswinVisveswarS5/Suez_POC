import { LightningElement, track, api, wire } from 'lwc';
import { gql, graphql } from 'lightning/uiGraphQLApi';

// Query 1: Get WorkOrder with LocationId
const WORKORDER_QUERY = gql`
  query getWorkOrder($recordId: ID!) {
    uiapi {
      query {
        WorkOrder(where: { Id: { eq: $recordId } }) {
          edges {
            node {
              Id
              Street { value }
              LocationId { value }
              Location {
                Name {
                  value
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Query 2: Get Location children of WorkOrder.LocationId
const LOCATION_QUERY = gql`
  query getLocationChildren($locationId: ID!) {
    uiapi {
      query {
        Location(where: { ParentLocationId: { eq: $locationId } }) {
          edges {
            node {
              Id 
              Name { value }
            }
          }
        }
      }
    }
  }
`;

// Query 3: Get Assets filtered by Location Ids
const ASSET_QUERY = gql`
  query getAssetsByLocations($assetLocationIds: [ID!]!) {
    uiapi {
      query {
        Asset(where: { LocationId: { in: $assetLocationIds } }) {
          edges {
            node {
              Id
              Name { value }
              LocationId { value }
            }
          }
        }
      }
    }
  }
`;

export default class Fsc_treeView extends LightningElement {
  @api recordId;
  @track isModalOpen = false;
  @track selectedNode;
  @track loading = true;
  @track error;
  @track treeData = [];
  locationId;
  assetLocationIds = [];

  buildTree(treeData, id, parentId, label, objectType) {
    const newNode = {
      label: label,
      id: id,
      objectType: objectType,
      expanded: false,
      hide: false,
      selected: false,
      items: []
    };

    //No parent → root node
    if (!parentId) {
      treeData.push(newNode);
      return treeData;
    }

    //Parent exists → insert as child
    this.insertChild(treeData, parentId, newNode);
    return treeData;
  }
  // Recursive child insertion
  insertChild(nodes, parentId, childNode) {
    for (let node of nodes) {
      if (node.id === parentId) {
        node.items.push(childNode);
        node.expanded = true;
        return true;
      }

      if (node.items && node.items.length > 0) {
        if (this.insertChild(node.items, parentId, childNode)) {
          return true;
        }
      }
    }
    return false;
  }


//  * Auto-calculate expanded based on children

  updateExpanded(nodes) {
    nodes.forEach(node => {
      node.expanded = node.items && node.items.length > 0;
      if (node.items && node.items.length > 0) {
        this.updateExpanded(node.items);
      }
    });
  }

  // Step 1: Get WorkOrder and extract LocationId
  @wire(graphql, {
    query: WORKORDER_QUERY,
    variables: '$workOrderVariables'
  })
  wiredWorkOrder({ data, errors }) {
    if (!data && !errors) {
      return;
    }

    try {
      if (errors && errors.length) {
        console.log('GraphQL errors:', errors);
        this.error = errors.map(e => e.message).join('; ');
        this.loading = false;
        return;
      }
      const edges = data?.uiapi?.query?.WorkOrder?.edges || [];
      console.log('WorkOrder Children:', edges);
      const woNode = edges.length ? edges[0].node : null;
      this.locationId = woNode?.LocationId?.value || null;

      if (this.locationId) {
        console.log('WO LocationId:', this.locationId);
        var locationName = woNode?.Location?.Name?.value || null;
        this.locationName = locationName ? locationName : 'Location not found';

        // Build tree data with WorkOrder Location as root
        this.treeData = this.buildTree(this.treeData, this.locationId, null, this.locationName, 'Location');
        // Proceed to step 2: Get Location children
        // Note: We'll trigger step 3 via the locationChildrenVariables getter
      } else {
        this.error = 'WorkOrder does not have a Location assigned';
        this.loading = false;
      }
    } catch (e) {
      this.error = e?.message || 'Error processing WorkOrder data';
      this.loading = false;
    }
  }

  // Step 2: Get Location children (only if we have a valid locationId)
  @wire(graphql, {
    query: LOCATION_QUERY,
    variables: '$locationChildrenVariables'
  })
  wiredLocationChildren({ data, errors }) {
    if (this.locationId) {
      if (!data && !errors) return;

      try {
        if (errors && errors.length) {
          this.error = errors.map(e => e.message).join('; ');
          this.loading = false;
          return;
        }

        const edges = data?.uiapi?.query?.Location?.edges || [];
        console.log('Location Children:', edges);
        // Extract location IDs properly

        // Loop through records and build tree
        const locationIds = [];
        if (this.locationId) {
          locationIds.push(this.locationId);
        }
        edges.forEach(({ node }) => {
          const id = node?.Id;
          const parentId = this.locationId;
          const label = node?.Name?.value;
          const objectType = 'Location';

          if (id) {
            locationIds.push(id);
          }

          if (id && label) {
            this.treeData = this.buildTree(
              this.treeData,
              id,
              parentId,
              label,
              objectType
            );
          }
        });

        // Now proceed to step 3: Get Assets
        if (locationIds.length > 0) {
          console.log('LocationIds:', locationIds);
          // This will trigger the asset query via the assetVariables getter
          this.assetLocationIds = [...new Set(locationIds)];
        } else {
          this.loading = false;
        }
      } catch (e) {
        this.error = e?.message || 'Error processing Location data';
        this.loading = false;
      }
    }
  }

  // Step 3: Get Assets filtered by Location Ids
  @wire(graphql, {
    query: ASSET_QUERY,
    variables: '$assetVariables'
  })
  wiredAssets({ data, errors }) {
    if (this.assetLocationIds.length > 0) {
      if (!data && !errors) return;

      try {
        if (errors && errors.length) {
          this.error = errors.map(e => e.message).join('; ');
          this.loading = false;
          return;
        }

        const edges = data?.uiapi?.query?.Asset?.edges || [];
        console.log('Assets:', edges);
        const assets = edges.map(e => ({
          id: e.node?.Id?.value,
          name: e.node?.Name?.value,
        }));

        // Add Assets to existing treeData (DO NOT reset treeData here)
        edges.forEach(({ node }) => {
          const id = node?.Id;
          const parentId = node?.LocationId?.value; // Parent = Location
          const label = node?.Name?.value;
          const objectType = 'Asset';

          if (id && parentId && label) {
            this.treeData = this.buildTree(
              this.treeData,
              id,
              parentId,
              label,
              objectType
            );
          }
        });

        console.log('Tree After Assets:' + JSON.stringify(this.treeData));

        //Update expanded flags
        this.updateExpanded(treeData);
        this.loading = false;
      } catch (e) {
        this.error = e?.message || 'Error building tree data';
        this.loading = false;
      }
    }
  }

  // console.log('Tree Data:'+ JSON.stringify(this.treeData));    

  handleNodeClick(event) {
    this.selectedNode = event.detail;
    this.isModalOpen = true;
  }

  handleCloseModal() {
    this.isModalOpen = false;
    this.selectedNode = undefined;
  }

  // Accessors for woDynamicForm params (adjust once you add real Ids into nodes)
  get selectedWorkOrderId() {
    return this.selectedNode?.workOrderId || this.selectedNode?.id || null;
  }
  get selectedAssetId() {
    return this.selectedNode?.assetId || null;
  }

  // Variables for WorkOrder query
  get workOrderVariables() {
    return {
      recordId: this.recordId,
    };
  }

  // Variables for Location children query
  get locationChildrenVariables() {
    if (!this.locationId) {
      return undefined; 
    }
    return { locationId: this.locationId };
  }

  // Variables for Asset query
  get assetVariables() {
    return this.assetLocationIds
      ? { assetLocationIds: this.assetLocationIds }
      : null;
  }
}