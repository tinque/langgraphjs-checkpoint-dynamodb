export interface WriteProperties {
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string;
    task_id: string;
    idx: number;
    channel: string;
    type: string;
    value: Uint8Array;
}

export interface DynamoDBWriteItem {
    thread_id_checkpoint_id_checkpoint_ns: string;
    task_id_idx: string;
    channel: string;
    type: string;
    value: Uint8Array;
}

export class Write {
    readonly thread_id: string;
    readonly checkpoint_ns: string;
    readonly checkpoint_id: string;
    readonly task_id: string;
    readonly idx: number;
    readonly channel: string;
    readonly type: string;
    readonly value: Uint8Array;

    constructor({
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        task_id,
        idx,
        channel,
        type,
        value,
    }: WriteProperties) {
        this.thread_id = thread_id;
        this.checkpoint_ns = checkpoint_ns;
        this.checkpoint_id = checkpoint_id;
        this.task_id = task_id;
        this.idx = idx;
        this.channel = channel;
        this.type = type;
        this.value = value;
    }

    toDynamoDBItem(): DynamoDBWriteItem {
        return {
            thread_id_checkpoint_id_checkpoint_ns: Write.getPartitionKey({
                thread_id: this.thread_id,
                checkpoint_id: this.checkpoint_id,
                checkpoint_ns: this.checkpoint_ns,
            }),
            task_id_idx: [this.task_id, this.idx].join(Write.separator()),
            channel: this.channel,
            type: this.type,
            value: this.value,
        };
    }

    static fromDynamoDBItem({
        thread_id_checkpoint_id_checkpoint_ns,
        task_id_idx,
        channel,
        type,
        value,
    }: DynamoDBWriteItem): Write {
        const [thread_id, checkpoint_id, checkpoint_ns] =
            thread_id_checkpoint_id_checkpoint_ns.split(this.separator());
        const [task_id, idx] = task_id_idx.split(this.separator());
        return new Write({
            thread_id,
            checkpoint_ns,
            checkpoint_id,
            task_id,
            idx: parseInt(idx, 10),
            channel,
            type,
            value,
        });
    }

    static getPartitionKey({
        thread_id,
        checkpoint_id,
        checkpoint_ns,
    }: {
        thread_id: string;
        checkpoint_id: string;
        checkpoint_ns: string;
    }): string {
        return [thread_id, checkpoint_id, checkpoint_ns].join(Write.separator());
    }

    static separator() {
        return ':::';
    }
}
