import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { BaseCheckpointSaver, } from '@langchain/langgraph-checkpoint';
import { Write } from './write';
/**
 * DynamoDBSaver is a class that provides persistence to
 * Langgraph's graphs using AWS's DynamoDB.
 *
 * @class
 * @extends BaseCheckpointSaver
 *
 * @param {Object} params - The parameters for the constructor.
 * @param {DynamoDBClientConfig} [params.clientConfig] - Optional configuration for the DynamoDB client.
 * @param {SerializerProtocol} [params.serde] - Optional serializer protocol for serializing and deserializing data.
 * @param {string} params.checkpointsTableName - The name of the DynamoDB table for storing checkpoints.
 * @param {string} params.writesTableName - The name of the DynamoDB table for storing writes.
 *
 * @property {DynamoDBClient} client - The DynamoDB client instance.
 * @property {DynamoDBDocument} docClient - The DynamoDB document client instance.
 * @property {string} checkpointsTableName - The name of the DynamoDB table for storing checkpoints.
 * @property {string} writesTableName - The name of the DynamoDB table for storing writes.
 *
 * @method getTuple - Retrieves a checkpoint tuple based on the provided configuration.
 * @param {RunnableConfig} config - The configuration for the runnable.
 * @returns {Promise<CheckpointTuple | undefined>} - A promise that resolves to a checkpoint tuple or undefined.
 *
 * @method list - Lists checkpoint tuples based on the provided configuration and options.
 * @param {RunnableConfig} config - The configuration for the runnable.
 * @param {CheckpointListOptions} [options] - Optional options for listing checkpoints.
 * @returns {AsyncGenerator<CheckpointTuple>} - An async generator that yields checkpoint tuples.
 *
 * @method put - Saves a checkpoint and its metadata to the DynamoDB table.
 * @param {RunnableConfig} config - The configuration for the runnable.
 * @param {Checkpoint} checkpoint - The checkpoint to save.
 * @param {CheckpointMetadata} metadata - The metadata associated with the checkpoint.
 * @returns {Promise<RunnableConfig>} - A promise that resolves to the updated runnable configuration.
 *
 * @method putWrites - Saves pending writes to the DynamoDB table.
 * @param {RunnableConfig} config - The configuration for the runnable.
 * @param {PendingWrite[]} writes - The pending writes to save.
 * @param {string} taskId - The task ID associated with the writes.
 * @returns {Promise<void>} - A promise that resolves when the writes are saved.
 *
 * @private
 * @method getWritePartitionKey - Generates a partition key for a write item.
 * @param {Object} item - The write item.
 * @param {string} item.thread_id - The thread ID.
 * @param {string} item.checkpoint_id - The checkpoint ID.
 * @param {string} item.checkpoint_ns - The checkpoint namespace.
 * @returns {string} - The generated partition key.
 *
 * @private
 * @method getWriteSortKey - Generates a sort key for a write item.
 * @param {Object} item - The write item.
 * @param {string} item.task_id - The task ID.
 * @param {number} item.idx - The index of the write.
 * @returns {string} - The generated sort key.
 *
 * @private
 * @method validateConfigurable - Validates the configurable object.
 * @param {Record<string, unknown> | undefined} configurable - The configurable object to validate.
 * @returns {ValidatedConfigurable} - The validated configurable object.
 * @throws {Error} - Throws an error if the configurable object is invalid.
 */
export class DynamoDBSaver extends BaseCheckpointSaver {
    client;
    docClient;
    checkpointsTableName;
    writesTableName;
    constructor({ clientConfig, serde, checkpointsTableName, writesTableName, }) {
        super(serde);
        this.client = new DynamoDBClient(clientConfig || {});
        this.docClient = DynamoDBDocument.from(this.client);
        this.checkpointsTableName = checkpointsTableName;
        this.writesTableName = writesTableName;
    }
    async getTuple(config) {
        const getItem = async (configurable) => {
            if (configurable.checkpoint_id != null) {
                // Use get
                const item = await this.docClient.get({
                    TableName: this.checkpointsTableName,
                    Key: {
                        thread_id: configurable.thread_id,
                        checkpoint_id: configurable.checkpoint_id,
                    },
                });
                return item.Item;
            }
            else {
                // Use query
                const result = await this.docClient.query({
                    TableName: this.checkpointsTableName,
                    KeyConditionExpression: 'thread_id = :thread_id',
                    ExpressionAttributeValues: {
                        ':thread_id': configurable.thread_id,
                        ...(configurable.checkpoint_ns && {
                            ':checkpoint_ns': configurable.checkpoint_ns,
                        }),
                    },
                    ...(configurable.checkpoint_ns && {
                        FilterExpression: 'checkpoint_ns = :checkpoint_ns',
                    }),
                    Limit: 1,
                    ConsistentRead: true,
                    ScanIndexForward: false, // Descending order
                });
                return result.Items?.[0];
            }
        };
        const item = await getItem(this.validateConfigurable(config.configurable));
        if (!item) {
            return undefined;
        }
        const checkpoint = (await this.serde.loadsTyped(item.type, item.checkpoint));
        const metadata = (await this.serde.loadsTyped(item.type, item.metadata));
        // Fetch pending writes
        const writesResult = await this.docClient.query({
            TableName: this.writesTableName,
            KeyConditionExpression: 'thread_id_checkpoint_id_checkpoint_ns = :thread_id_checkpoint_id_checkpoint_ns',
            ExpressionAttributeValues: {
                ':thread_id_checkpoint_id_checkpoint_ns': Write.getPartitionKey(item),
            },
        });
        const pendingWrites = [];
        if (writesResult.Items) {
            for (const writeItem of writesResult.Items) {
                const write = Write.fromDynamoDBItem(writeItem);
                const value = await this.serde.loadsTyped(write.type, write.value);
                pendingWrites.push([write.task_id, write.channel, value]);
            }
        }
        return {
            config: {
                configurable: {
                    thread_id: item.thread_id,
                    checkpoint_ns: item.checkpoint_ns,
                    checkpoint_id: item.checkpoint_id,
                },
            },
            checkpoint,
            metadata,
            parentConfig: item.parent_checkpoint_id
                ? {
                    configurable: {
                        thread_id: item.thread_id,
                        checkpoint_ns: item.checkpoint_ns,
                        checkpoint_id: item.parent_checkpoint_id,
                    },
                }
                : undefined,
            pendingWrites,
        };
    }
    async *list(config, options) {
        const { limit, before } = options ?? {};
        const thread_id = config.configurable?.thread_id;
        const expressionAttributeValues = {
            ':thread_id': thread_id,
        };
        let keyConditionExpression = 'thread_id = :thread_id';
        if (before?.configurable?.checkpoint_id) {
            keyConditionExpression += ' AND checkpoint_id < :before_checkpoint_id';
            expressionAttributeValues[':before_checkpoint_id'] = before.configurable.checkpoint_id;
        }
        const result = await this.docClient.query({
            TableName: this.checkpointsTableName,
            KeyConditionExpression: keyConditionExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            Limit: limit,
            ScanIndexForward: false, // Descending order
        });
        if (result.Items) {
            for (const item of result.Items) {
                const checkpoint = (await this.serde.loadsTyped(item.type, item.checkpoint));
                const metadata = (await this.serde.loadsTyped(item.type, item.metadata));
                yield {
                    config: {
                        configurable: {
                            thread_id: item.thread_id,
                            checkpoint_ns: item.checkpoint_ns,
                            checkpoint_id: item.checkpoint_id,
                        },
                    },
                    checkpoint,
                    metadata,
                    parentConfig: item.parent_checkpoint_id
                        ? {
                            configurable: {
                                thread_id: item.thread_id,
                                checkpoint_ns: item.checkpoint_ns,
                                checkpoint_id: item.parent_checkpoint_id,
                            },
                        }
                        : undefined,
                };
            }
        }
    }
    async put(config, checkpoint, metadata) {
        const { thread_id } = this.validateConfigurable(config.configurable);
        const [type1, serializedCheckpoint] = this.serde.dumpsTyped(checkpoint);
        const [type2, serializedMetadata] = this.serde.dumpsTyped(metadata);
        if (type1 !== type2) {
            throw new Error('Failed to serialize checkpoint and metadata to the same type.');
        }
        const item = {
            thread_id,
            checkpoint_ns: config.configurable?.checkpoint_ns ?? '',
            checkpoint_id: checkpoint.id,
            parent_checkpoint_id: config.configurable?.checkpoint_id,
            type: type1,
            checkpoint: serializedCheckpoint,
            metadata: serializedMetadata,
        };
        await this.docClient.put({
            TableName: this.checkpointsTableName,
            Item: item,
        });
        return {
            configurable: {
                thread_id: item.thread_id,
                checkpoint_ns: item.checkpoint_ns,
                checkpoint_id: item.checkpoint_id,
            },
        };
    }
    async putWrites(config, writes, taskId) {
        const { thread_id, checkpoint_ns, checkpoint_id } = this.validateConfigurable(config.configurable);
        if (checkpoint_id == null) {
            throw new Error('Missing checkpoint_id');
        }
        const writeItems = writes.map((write, idx) => {
            const [type, serializedValue] = this.serde.dumpsTyped(write[1]);
            const item = new Write({
                thread_id,
                checkpoint_ns,
                checkpoint_id,
                task_id: taskId,
                idx,
                channel: write[0],
                type,
                value: serializedValue,
            });
            return {
                PutRequest: {
                    Item: item.toDynamoDBItem(),
                },
            };
        });
        // Batch write items
        const batches = [];
        for (let i = 0; i < writeItems.length; i += 25) {
            batches.push(writeItems.slice(i, i + 25));
        }
        for (const batch of batches) {
            await this.docClient.batchWrite({
                RequestItems: {
                    [this.writesTableName]: batch,
                },
            });
        }
    }
    getWritePartitionKey(item) {
        return `${item.thread_id}:${item.checkpoint_id}:${item.checkpoint_ns}`;
    }
    getWriteSortKey(item) {
        return `${item.task_id}:${item.idx}`;
    }
    validateConfigurable(configurable) {
        if (!configurable) {
            throw new Error('Missing configurable');
        }
        const { thread_id, checkpoint_ns, checkpoint_id } = configurable;
        if (typeof thread_id !== 'string') {
            throw new Error('Invalid thread_id');
        }
        if (typeof checkpoint_ns !== 'string' && checkpoint_ns !== undefined) {
            throw new Error('Invalid checkpoint_ns');
        }
        if (typeof checkpoint_id !== 'string' && checkpoint_id !== undefined) {
            throw new Error('Invalid checkpoint_id');
        }
        return {
            thread_id,
            checkpoint_ns: checkpoint_ns ?? '',
            checkpoint_id: checkpoint_id,
        };
    }
}
//# sourceMappingURL=saver.js.map