export interface CheckpointItem {
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string;
    parent_checkpoint_id?: string;
    type: string;
    checkpoint: Uint8Array<ArrayBufferLike>;
    metadata: Uint8Array<ArrayBufferLike>;
}

export interface WriteItem {
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string;
    task_id: string;
    idx: number;
    channel: string;
    type: string;
    value: Uint8Array<ArrayBufferLike>;
}

export interface ValidatedConfigurable {
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string | undefined;
}
