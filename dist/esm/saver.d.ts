import { type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import type { RunnableConfig } from '@langchain/core/runnables';
import { BaseCheckpointSaver, type SerializerProtocol, type CheckpointTuple, type Checkpoint, type CheckpointMetadata, type CheckpointListOptions, type PendingWrite } from '@langchain/langgraph-checkpoint';
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
export declare class DynamoDBSaver extends BaseCheckpointSaver {
    private client;
    private docClient;
    private checkpointsTableName;
    private writesTableName;
    constructor({ clientConfig, serde, checkpointsTableName, writesTableName, }: {
        clientConfig?: DynamoDBClientConfig;
        serde?: SerializerProtocol;
        checkpointsTableName: string;
        writesTableName: string;
    });
    getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined>;
    list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple>;
    put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig>;
    putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void>;
    private getWritePartitionKey;
    private getWriteSortKey;
    private validateConfigurable;
}
