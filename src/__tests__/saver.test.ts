/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
    Checkpoint,
    CheckpointTuple,
    uuid6,
    CheckpointMetadata,
} from '@langchain/langgraph-checkpoint';
import { DynamoDBSaver } from '../saver';
import { MockDynamoDBDocument } from '../__mocks__/DynamoDBDocument.mock';
import { SerializerProtocol } from '@langchain/langgraph-checkpoint';
import type { PendingWrite } from '@langchain/langgraph-checkpoint';

// Mock Serializer
class MockSerializer implements SerializerProtocol {
    dumpsTyped(value: any): [string, Uint8Array] {
        return ['json', new TextEncoder().encode(JSON.stringify(value))];
    }

    async loadsTyped(type: string, value: Uint8Array | string): Promise<any> {
        switch (type) {
            case 'json':
                return JSON.parse(
                    typeof value === 'string' ? value : new TextDecoder().decode(value)
                );
            default:
                throw new Error(`Unsupported type: ${type}`);
        }
    }
}

const checkpoint1: Checkpoint = {
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

const checkpoint2: Checkpoint = {
    v: 1,
    id: uuid6(1),
    ts: '2024-04-20T17:19:07.952Z',
    channel_values: {
        someKey1: 'someValue2',
    },
    channel_versions: {
        someKey2: 2,
    },
    versions_seen: {
        someKey3: {
            someKey4: 2,
        },
    },
    pending_sends: [],
};

describe('DynamoDBSaver', () => {
    let saver: DynamoDBSaver;
    let mockDocClient: MockDynamoDBDocument;
    let serializer: MockSerializer;

    beforeEach(() => {
        mockDocClient = new MockDynamoDBDocument();
        serializer = new MockSerializer();

        // Initialize the DynamoDBSaver with the mock client
        saver = new DynamoDBSaver({
            clientConfig: {}, // Empty config since we're mocking
            serde: serializer,
            checkpointsTableName: 'Checkpoints',
            writesTableName: 'Writes',
        });

        // Replace the real docClient with the mock
        (saver as any).docClient = mockDocClient;
    });

    it('should save and retrieve checkpoints correctly', async () => {
        // Get undefined checkpoint
        const undefinedCheckpoint = await saver.getTuple({
            configurable: { thread_id: '1' },
        });
        expect(undefinedCheckpoint).toBeUndefined();

        // Save first checkpoint
        const runnableConfig = await saver.put({ configurable: { thread_id: '1' } }, checkpoint1, {
            source: 'update',
            step: -1,
            writes: null,
        } as CheckpointMetadata);
        expect(runnableConfig).toEqual({
            configurable: {
                thread_id: '1',
                checkpoint_ns: '',
                checkpoint_id: checkpoint1.id,
            },
        });

        // Add some writes
        await saver.putWrites(
            {
                configurable: {
                    thread_id: '1',
                    checkpoint_ns: '',
                    checkpoint_id: checkpoint1.id,
                },
            },
            [['bar', 'baz']] as PendingWrite[],
            'foo'
        );

        // Get first checkpoint tuple
        const firstCheckpointTuple = await saver.getTuple({
            configurable: { thread_id: '1' },
        });
        expect(firstCheckpointTuple?.config).toEqual({
            configurable: {
                thread_id: '1',
                checkpoint_ns: '',
                checkpoint_id: checkpoint1.id,
            },
        });
        expect(firstCheckpointTuple?.checkpoint).toEqual(checkpoint1);
        expect(firstCheckpointTuple?.parentConfig).toBeUndefined();
        expect(firstCheckpointTuple?.pendingWrites).toEqual([['foo', 'bar', 'baz']]);

        // Save second checkpoint with parent_checkpoint_id
        await saver.put(
            {
                configurable: {
                    thread_id: '1',
                    checkpoint_ns: '',
                    checkpoint_id: '2024-04-18T17:19:07.952Z',
                },
            },
            checkpoint2,
            { source: 'update', step: -1, writes: null } as CheckpointMetadata
        );

        // Verify that parentConfig is set and retrieved correctly for second checkpoint
        const secondCheckpointTuple = await saver.getTuple({
            configurable: { thread_id: '1' },
        });
        expect(secondCheckpointTuple?.parentConfig).toEqual({
            configurable: {
                thread_id: '1',
                checkpoint_ns: '',
                checkpoint_id: '2024-04-18T17:19:07.952Z',
            },
        });

        // List checkpoints
        const checkpointTuples: CheckpointTuple[] = [];
        for await (const checkpoint of saver.list({
            configurable: { thread_id: '1' },
        })) {
            checkpointTuples.push(checkpoint);
        }
        expect(checkpointTuples.length).toBe(2);

        const checkpointTuple1 = checkpointTuples[0];
        const checkpointTuple2 = checkpointTuples[1];
        expect(checkpointTuple1.checkpoint.ts).toBe('2024-04-20T17:19:07.952Z');
        expect(checkpointTuple2.checkpoint.ts).toBe('2024-04-19T17:19:07.952Z');
    });

    it('should throw an error when thread_id is missing in getTuple', async () => {
        const config = {
            configurable: {
                checkpoint_id: 'checkpoint1',
            },
        };

        try {
            await saver.getTuple(config);
            throw new Error("Expected function to throw an error, but it didn't");
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as any).message).toBe('Invalid thread_id');
        }
    });

    it('should throw an error when checkpoint_id is invalid in getTuple', async () => {
        const config = {
            configurable: {
                thread_id: '1',
                checkpoint_id: 123, // Invalid type
            },
        };

        try {
            await saver.getTuple(config);
            throw new Error("Expected function to throw an error, but it didn't");
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as any).message).toBe('Invalid checkpoint_id');
        }
    });

    it.skip('should throw an error when serializer returns unsupported type', async () => {
        // jest.spyOn(serializer, 'dumpsTyped').mockImplementation(() => ['unsupported', 'data']);
        // const config = {
        //   configurable: {
        //     thread_id: '1',
        //   },
        // };
        // const checkpoint = { id: 'checkpoint1', data: 'some data' };
        // const metadata = { source: 'update', step: -1, writes: null } as CheckpointMetadata;
        // await expect(saver.put(config, checkpoint, metadata)).rejects.toThrow('Unsupported type: unsupported');
    });

    it.skip('should handle deserialization errors gracefully in getTuple', async () => {
        // jest.spyOn(serializer, 'loadsTyped').mockImplementation(() => {
        //   throw new Error('Deserialization error');
        // });
        // const config = {
        //   configurable: {
        //     thread_id: '1',
        //   },
        // };
        // const checkpoint = { id: 'checkpoint1', data: 'some data' };
        // const metadata = { source: 'update', step: -1, writes: null } as CheckpointMetadata;
        // await saver.put(config, checkpoint, metadata);
        // await expect(saver.getTuple(config)).rejects.toThrow('Deserialization error');
    });

    it('should handle checkpoints with empty data', async () => {
        const config = {
            configurable: {
                thread_id: '1',
            },
        };

        const checkpoint = { id: 'checkpoint1' } as Checkpoint;
        const metadata = {} as CheckpointMetadata;

        await saver.put(config, checkpoint, metadata);

        const retrieved = await saver.getTuple(config);
        expect(retrieved?.checkpoint).toEqual(checkpoint);
        expect(retrieved?.metadata).toEqual(metadata);
    });

    it('should handle checkpoints with null values', async () => {
        const config = {
            configurable: {
                thread_id: '1',
            },
        };

        const checkpoint = {
            id: 'checkpoint1',
            data: null,
            channel_values: null,
        } as unknown as Checkpoint;
        const metadata = { source: null } as unknown as CheckpointMetadata;

        await saver.put(config, checkpoint, metadata);

        const retrieved = await saver.getTuple(config);
        expect(retrieved?.checkpoint).toEqual(checkpoint);
        expect(retrieved?.metadata).toEqual(metadata);
    });

    it('should handle item size limit exceeded error', async () => {
        // Create a large data payload
        const largeData = 'x'.repeat(500 * 1024); // 500 KB

        const config = {
            configurable: {
                thread_id: '1',
            },
        };

        const checkpoint = { id: 'checkpoint1', data: largeData } as unknown as Checkpoint;
        const metadata = { source: 'update', step: -1, writes: null } as CheckpointMetadata;

        try {
            await saver.put(config, checkpoint, metadata);
            throw new Error("Expected function to throw an error, but it didn't");
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as any).message).toBe('Item size has exceeded the maximum allowed size');
        }
    });

    it('should handle special characters in keys and values', async () => {
        const config = {
            configurable: {
                thread_id: 'thread-特殊字符',
            },
        };

        const checkpoint = {
            id: 'checkpoint-特殊字符',
            data: 'data with special characters: 特殊字符',
        } as unknown as Checkpoint;
        const metadata = { source: 'update', step: -1, writes: null } as CheckpointMetadata;

        await saver.put(config, checkpoint, metadata);

        const retrieved = await saver.getTuple(config);
        expect(retrieved?.checkpoint).toEqual(checkpoint);
        expect(retrieved?.metadata).toEqual(metadata);
    });
});
