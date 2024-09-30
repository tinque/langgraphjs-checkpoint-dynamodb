export interface CheckpointItem {
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string;
    parent_checkpoint_id?: string;
    type: string;
    checkpoint: Uint8Array;
    metadata: Uint8Array;
}

export interface ValidatedConfigurable {
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string | undefined;
}
