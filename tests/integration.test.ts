import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DynamoDBSaver } from '../src/saver';
import {
    DynamoDBClient,
    CreateTableCommand,
    DeleteTableCommand,
    DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import { CheckpointMetadata, uuid6 } from '@langchain/langgraph-checkpoint';

// Helper function to wait for table to become ACTIVE
async function waitForTableActive(client: DynamoDBClient, tableName: string) {
    while (true) {
        const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
        if (Table?.TableStatus === 'ACTIVE') {
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function waitForTableDeleted(client: DynamoDBClient, tableName: string) {
    while (true) {
        try {
            await client.send(new DescribeTableCommand({ TableName: tableName }));
        } catch (e) {
            if (e.name === 'ResourceNotFoundException') {
                break;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

describe('DynamoDBSaver', () => {
    const checkpointsTableName = 'checkpoints';
    const writesTableName = 'writes';

    const saver = new DynamoDBSaver({
        clientConfig: {
            endpoint: process.env.AWS_DYNAMODB_ENDPOINT,
        },
        checkpointsTableName,
        writesTableName,
    });

    describe('integration', () => {
        beforeEach(async () => {
            const client = new DynamoDBClient({
                endpoint: process.env.AWS_DYNAMODB_ENDPOINT,
            });

            await client.send(
                new CreateTableCommand({
                    TableName: checkpointsTableName,
                    KeySchema: [
                        { AttributeName: 'thread_id', KeyType: 'HASH' }, // Partition key
                        { AttributeName: 'checkpoint_id', KeyType: 'RANGE' }, // Sort key
                    ],
                    AttributeDefinitions: [
                        { AttributeName: 'thread_id', AttributeType: 'S' },
                        { AttributeName: 'checkpoint_id', AttributeType: 'S' },
                    ],
                    BillingMode: 'PAY_PER_REQUEST',
                })
            );

            await client.send(
                new CreateTableCommand({
                    TableName: writesTableName,
                    KeySchema: [
                        { AttributeName: 'partition_key', KeyType: 'HASH' }, // Partition key
                        { AttributeName: 'sort_key', KeyType: 'RANGE' }, // Sort key
                    ],
                    AttributeDefinitions: [
                        { AttributeName: 'partition_key', AttributeType: 'S' },
                        { AttributeName: 'sort_key', AttributeType: 'S' },
                    ],
                    BillingMode: 'PAY_PER_REQUEST',
                })
            );

            await waitForTableActive(client, checkpointsTableName);
            await waitForTableActive(client, writesTableName);
        });

        afterEach(async () => {
            const client = new DynamoDBClient({
                endpoint: process.env.AWS_DYNAMODB_ENDPOINT,
            });

            await client.send(
                new DeleteTableCommand({
                    TableName: checkpointsTableName,
                })
            );

            await client.send(
                new DeleteTableCommand({
                    TableName: writesTableName,
                })
            );

            await waitForTableDeleted(client, checkpointsTableName);
            await waitForTableDeleted(client, writesTableName);
        });

        it('should save and load checkpoints', async () => {
            const checkpoint = {
                v: 1,
                id: uuid6(-1),
                ts: '2024-04-19T17:19:07.952Z',
                channel_values: {
                    someKey1: 'someValue1',
                },
                channel_versions: {
                    someKey2: 1,
                },
                versions_seen: {
                    someKey3: {
                        someKey4: 1,
                    },
                },
                pending_sends: [],
            };

            await saver.put({ configurable: { thread_id: '1' } }, checkpoint, {
                source: 'update',
                step: -1,
                writes: null,
            } as CheckpointMetadata);

            const loadedCheckpoint = await saver.getTuple({
                configurable: { thread_id: '1' },
            });

            expect(loadedCheckpoint).not.toBeUndefined();
            expect(loadedCheckpoint?.checkpoint.id).toEqual(checkpoint.id);
        });

        it('should save and load writes', async () => {
            const checkpoint = {
                v: 1,
                id: uuid6(-1),
                ts: '2024-04-19T17:19:07.952Z',
                channel_values: {
                    someKey1: 'someValue1',
                },
                channel_versions: {
                    someKey2: 1,
                },
                versions_seen: {
                    someKey3: {
                        someKey4: 1,
                    },
                },
                pending_sends: [],
            };

            const writes = {
                writes: [
                    {
                        id: '1',
                        v: 1,
                        ts: '2024-04-19T17:19:07.952Z',
                        channel_values: {
                            someKey1: 'someValue1',
                        },
                        channel_versions: {
                            someKey2: 1,
                        },
                        versions_seen: {
                            someKey3: {
                                someKey4: 1,
                            },
                        },
                        pending_sends: [],
                    },
                ],
            };

            await saver.put({ configurable: { thread_id: '1' } }, checkpoint, {
                source: 'update',
                step: -1,
                writes,
            } as CheckpointMetadata);

            const loadedWrites = await saver.getTuple({
                configurable: { thread_id: '1' },
            });

            expect(loadedWrites).not.toBeUndefined();
            expect(loadedWrites?.metadata?.writes).toEqual(writes);
        });
    });
});
