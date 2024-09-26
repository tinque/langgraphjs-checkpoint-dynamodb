/* eslint-disable @typescript-eslint/no-explicit-any */
export class MockDynamoDBDocument {
    private tables: Record<string, Record<string, any>> = {};

    constructor() {
        // Initialize in-memory tables
        this.tables = {};
    }

    async get(params: { TableName: string; Key: Record<string, any> }) {
        const { TableName, Key } = params;
        const table = this.tables[TableName] || {};
        const itemKey = JSON.stringify(Key);
        const Item = table[itemKey];
        return { Item };
    }

    async put(params: { TableName: string; Item: any }) {
        const { TableName, Item } = params;

        this.sizeGuard(Item);

        const table = this.tables[TableName] || {};
        const keyAttributes = this.getKeyAttributes(Item);
        const itemKey = JSON.stringify(keyAttributes);
        table[itemKey] = Item;
        this.tables[TableName] = table;
        return {};
    }

    async query(params: {
        TableName: string;
        KeyConditionExpression: string;
        ExpressionAttributeValues: Record<string, any>;
        Limit?: number;
        ScanIndexForward?: boolean;
        FilterExpression?: string;
        ConsistentRead?: boolean;
    }) {
        const { TableName, ExpressionAttributeValues, Limit, ScanIndexForward } = params;
        const table = this.tables[TableName] || {};
        const items = Object.values(table);

        // Simulate filtering based on KeyConditionExpression (simplified for example)
        const filteredItems = items.filter(item => {
            for (const key in ExpressionAttributeValues) {
                const attributeName = key.replace(':', '');
                if (item[attributeName] !== ExpressionAttributeValues[key]) {
                    return false;
                }
            }
            return true;
        });

        // Sort items if ScanIndexForward is specified
        if (ScanIndexForward !== undefined) {
            filteredItems.sort((a, b) => {
                const aKey = a.checkpoint_id;
                const bKey = b.checkpoint_id;
                if (ScanIndexForward) {
                    return aKey.localeCompare(bKey);
                } else {
                    return bKey.localeCompare(aKey);
                }
            });
        }

        // Apply Limit if specified
        const limitedItems = Limit ? filteredItems.slice(0, Limit) : filteredItems;

        return { Items: limitedItems };
    }

    async batchWrite(params: { RequestItems: Record<string, any[]> }) {
        for (const TableName in params.RequestItems) {
            const table = this.tables[TableName] || {};
            for (const request of params.RequestItems[TableName]) {
                if (request.PutRequest) {
                    const Item = request.PutRequest.Item;
                    this.sizeGuard(Item);
                    const keyAttributes = this.getKeyAttributes(Item);
                    const itemKey = JSON.stringify(keyAttributes);
                    table[itemKey] = Item;
                }
                // Handle DeleteRequest if needed
            }
            this.tables[TableName] = table;
        }
        return {};
    }

    private calculateItemSize(item: any): number {
        // Serialize the item to a JSON string
        const serializedItem = JSON.stringify(item);

        // Calculate the byte length of the serialized item using UTF-8 encoding
        const itemSizeInBytes = new TextEncoder().encode(serializedItem).length;

        return itemSizeInBytes;
    }

    // Helper method to extract key attributes from an item
    private getKeyAttributes(item: any): Record<string, any> {
        const keyAttributes: Record<string, any> = {};
        if (item.thread_id) keyAttributes.thread_id = item.thread_id;
        if (item.checkpoint_id) keyAttributes.checkpoint_id = item.checkpoint_id;
        return keyAttributes;
    }

    private sizeGuard(item: any) {
        const itemSizeInBytes = this.calculateItemSize(item);
        if (itemSizeInBytes > 409600) {
            throw new Error('Item size has exceeded the maximum allowed size');
        }
    }
}
