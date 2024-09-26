import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
    BaseCheckpointSaver,
    type SerializerProtocol,
    type CheckpointTuple,
    type Checkpoint,
    type CheckpointMetadata,
    type CheckpointPendingWrite,
    type CheckpointListOptions,
    type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { ValidatedConfigurable, CheckpointItem, WriteItem } from './types';

export class DynamoDBSaver extends BaseCheckpointSaver {
    private client: DynamoDBClient;
    private docClient: DynamoDBDocument;
    private checkpointsTableName: string;
    private writesTableName: string;

    constructor({
        clientConfig,
        serde,
        checkpointsTableName,
        writesTableName,
    }: {
        clientConfig?: DynamoDBClientConfig;
        serde?: SerializerProtocol;
        checkpointsTableName: string;
        writesTableName: string;
    }) {
        super(serde);
        this.client = new DynamoDBClient(clientConfig || {});
        this.docClient = DynamoDBDocument.from(this.client);
        this.checkpointsTableName = checkpointsTableName;
        this.writesTableName = writesTableName;
    }

    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        const getItem = async (configurable: ValidatedConfigurable) => {
            if (configurable.checkpoint_id != null) {
                // Use get
                const item = await this.docClient.get({
                    TableName: this.checkpointsTableName,
                    Key: {
                        thread_id: configurable.thread_id,
                        checkpoint_id: configurable.checkpoint_id,
                    },
                });

                return item.Item as CheckpointItem | undefined;
            } else {
                // Use query
                const result = await this.docClient.query({
                    TableName: this.checkpointsTableName,
                    KeyConditionExpression: 'thread_id = :thread_id',
                    ExpressionAttributeValues: {
                        ':thread_id': configurable.thread_id,
                    },
                    ...(configurable.checkpoint_ns && {
                        FilterExpression: `checkpoint_ns = ${configurable.checkpoint_ns}`,
                    }),
                    Limit: 1,
                    ConsistentRead: true,
                    ScanIndexForward: false, // Descending order
                });

                return result.Items?.[0] as CheckpointItem | undefined;
            }
        };

        const item = await getItem(this.validateConfigurable(config.configurable));
        if (!item) {
            return undefined;
        }

        const checkpoint = (await this.serde.loadsTyped(item.type, item.checkpoint)) as Checkpoint;
        const metadata = (await this.serde.loadsTyped(
            item.type,
            item.metadata
        )) as CheckpointMetadata;

        // Fetch pending writes
        const writesResult = await this.docClient.query({
            TableName: this.writesTableName,
            KeyConditionExpression: 'partition_key = :partition_key',
            ExpressionAttributeValues: {
                ':partition_key': `${item.thread_id}:${item.checkpoint_id}:${item.checkpoint_ns}`,
            },
        });

        const pendingWrites: CheckpointPendingWrite[] = [];
        if (writesResult.Items) {
            for (const writeItem of writesResult.Items as WriteItem[]) {
                const value = await this.serde.loadsTyped(writeItem.type, writeItem.value);
                pendingWrites.push([writeItem.task_id, writeItem.channel, value]);
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

    async *list(
        config: RunnableConfig,
        options?: CheckpointListOptions
    ): AsyncGenerator<CheckpointTuple> {
        const { limit, before } = options ?? {};
        const thread_id = config.configurable?.thread_id;

        const expressionAttributeValues: Record<string, unknown> = {
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
            for (const item of result.Items as CheckpointItem[]) {
                const checkpoint = (await this.serde.loadsTyped(
                    item.type,
                    item.checkpoint
                )) as Checkpoint;
                const metadata = (await this.serde.loadsTyped(
                    item.type,
                    item.metadata
                )) as CheckpointMetadata;

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

    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata
    ): Promise<RunnableConfig> {
        const { thread_id } = this.validateConfigurable(config.configurable);

        const [type1, serializedCheckpoint] = this.serde.dumpsTyped(checkpoint);
        const [type2, serializedMetadata] = this.serde.dumpsTyped(metadata);

        if (type1 !== type2) {
            throw new Error('Failed to serialize checkpoint and metadata to the same type.');
        }

        const item: CheckpointItem = {
            thread_id,
            checkpoint_ns: config.configurable?.checkpoint_ns ?? '',
            checkpoint_id: checkpoint.id!,
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

    async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
        const { thread_id, checkpoint_ns, checkpoint_id } = this.validateConfigurable(
            config.configurable
        );

        if (checkpoint_id == null) {
            throw new Error('Missing checkpoint_id');
        }

        const writeItems = writes.map((write, idx) => {
            const [type, serializedValue] = this.serde.dumpsTyped(write[1]);
            const item: WriteItem = {
                thread_id,
                checkpoint_ns,
                checkpoint_id,
                task_id: taskId,
                idx,
                channel: write[0],
                type,
                value: serializedValue,
            };
            return {
                PutRequest: {
                    Item: item,
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

    private validateConfigurable(
        configurable: Record<string, unknown> | undefined
    ): ValidatedConfigurable {
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
