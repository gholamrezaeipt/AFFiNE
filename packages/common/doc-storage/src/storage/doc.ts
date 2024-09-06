import {
  applyUpdate,
  diffUpdate,
  Doc,
  encodeStateAsUpdate,
  encodeStateVector,
  encodeStateVectorFromUpdate,
  mergeUpdates,
  UndoManager,
} from 'yjs';

import { Connection } from './connection';
import { SingletonLocker } from './lock';

export interface DocRecord {
  spaceId: string;
  docId: string;
  bin: Uint8Array;
  timestamp: number;
  editor?: string;
}

export interface DocDiff {
  missing: Uint8Array;
  state: Uint8Array;
  timestamp: number;
}

export interface DocUpdate {
  bin: Uint8Array;
  timestamp: number;
  editor?: string;
}

export interface HistoryFilter {
  before?: number;
  limit?: number;
}

export interface Editor {
  name: string;
  avatarUrl: string | null;
}

export interface DocStorageOptions {
  mergeUpdates?: (updates: Uint8Array[]) => Promise<Uint8Array> | Uint8Array;
}

export abstract class DocStorageAdapter extends Connection {
  private readonly locker = new SingletonLocker();
  protected abstract readonly spaceId: string;
  protected readonly updatesListeners = new Set<
    (docId: string, updates: Uint8Array[], timestamp: number) => void
  >();

  constructor(
    protected readonly options: DocStorageOptions = {
      mergeUpdates,
    }
  ) {
    super();
  }

  // open apis
  isEmptyBin(bin: Uint8Array): boolean {
    return (
      bin.length === 0 ||
      // 0x0 for state vector
      (bin.length === 1 && bin[0] === 0) ||
      // 0x00 for update
      (bin.length === 2 && bin[0] === 0 && bin[1] === 0)
    );
  }

  async getDoc(docId: string): Promise<DocRecord | null> {
    await using _lock = await this.lockDocForUpdate(docId);

    const snapshot = await this.getDocSnapshot(docId);
    const updates = await this.getDocUpdates(docId);

    if (updates.length) {
      const { timestamp, bin, editor } = await this.squash(
        snapshot ? [snapshot, ...updates] : updates
      );

      const newSnapshot = {
        spaceId: this.spaceId,
        docId,
        bin,
        timestamp,
        editor,
      };

      const success = await this.setDocSnapshot(newSnapshot);

      // if there is old snapshot, create a new history record
      if (success && snapshot) {
        await this.createDocHistory(snapshot);
      }

      // always mark updates as merged unless throws
      await this.markUpdatesMerged(docId, updates);

      return newSnapshot;
    }

    return snapshot;
  }

  async getDocDiff(
    docId: string,
    stateVector?: Uint8Array
  ): Promise<DocDiff | null> {
    const doc = await this.getDoc(docId);

    if (!doc) {
      return null;
    }

    const missing = stateVector ? diffUpdate(doc.bin, stateVector) : doc.bin;
    const state = encodeStateVectorFromUpdate(doc.bin);

    return {
      missing,
      state,
      timestamp: doc.timestamp,
    };
  }

  abstract pushDocUpdates(
    docId: string,
    updates: Uint8Array[],
    editorId?: string
  ): Promise<number>;

  onReceiveDocUpdates(
    listener: (docId: string, updates: Uint8Array[], timestamp: number) => void
  ): () => void {
    this.updatesListeners.add(listener);

    return () => {
      this.updatesListeners.delete(listener);
    };
  }

  protected dispatchDocUpdatesListeners(
    docId: string,
    updates: Uint8Array[],
    timestamp: number
  ): void {
    this.updatesListeners.forEach(cb => {
      cb(docId, updates, timestamp);
    });
  }

  abstract deleteDoc(docId: string): Promise<void>;
  abstract deleteSpace(): Promise<void>;
  async rollbackDoc(
    docId: string,
    timestamp: number,
    editorId?: string
  ): Promise<void> {
    await using _lock = await this.lockDocForUpdate(docId);
    const toSnapshot = await this.getDocHistory(docId, timestamp);
    if (!toSnapshot) {
      throw new Error('Can not find the version to rollback to.');
    }

    const fromSnapshot = await this.getDocSnapshot(docId);

    if (!fromSnapshot) {
      throw new Error('Can not find the current version of the doc.');
    }

    const change = this.generateChangeUpdate(fromSnapshot.bin, toSnapshot.bin);
    await this.pushDocUpdates(docId, [change], editorId);
    // force create a new history record after rollback
    await this.createDocHistory(fromSnapshot, true);
  }

  abstract getSpaceDocTimestamps(
    after?: number
  ): Promise<Record<string, number> | null>;
  abstract listDocHistories(
    docId: string,
    query: { skip?: number; limit?: number }
  ): Promise<{ timestamp: number; editor: Editor | null }[]>;
  abstract getDocHistory(
    docId: string,
    timestamp: number
  ): Promise<DocRecord | null>;

  // api for internal usage
  protected abstract getDocSnapshot(docId: string): Promise<DocRecord | null>;
  protected abstract setDocSnapshot(snapshot: DocRecord): Promise<boolean>;
  protected abstract getDocUpdates(docId: string): Promise<DocUpdate[]>;
  protected abstract markUpdatesMerged(
    docId: string,
    updates: DocUpdate[]
  ): Promise<number>;

  protected abstract createDocHistory(
    snapshot: DocRecord,
    force?: boolean
  ): Promise<boolean>;

  protected async squash(updates: DocUpdate[]): Promise<DocUpdate> {
    const merge = this.options?.mergeUpdates ?? mergeUpdates;
    const lastUpdate = updates.at(-1);
    if (!lastUpdate) {
      throw new Error('No updates to be squashed.');
    }

    // fast return
    if (updates.length === 1) {
      return lastUpdate;
    }

    const finalUpdate = await merge(updates.map(u => u.bin));

    return {
      bin: finalUpdate,
      timestamp: lastUpdate.timestamp,
      editor: lastUpdate.editor,
    };
  }

  protected async lockDocForUpdate(docId: string): Promise<AsyncDisposable> {
    return this.locker.lock(`workspace:${this.spaceId}:update`, docId);
  }

  protected generateChangeUpdate(newerBin: Uint8Array, olderBin: Uint8Array) {
    const newerDoc = new Doc();
    applyUpdate(newerDoc, newerBin);
    const olderDoc = new Doc();
    applyUpdate(olderDoc, olderBin);

    const newerState = encodeStateVector(newerDoc);
    const olderState = encodeStateVector(olderDoc);

    const diff = encodeStateAsUpdate(newerDoc, olderState);

    const undoManager = new UndoManager(Array.from(newerDoc.share.values()));

    applyUpdate(olderDoc, diff);

    undoManager.undo();

    return encodeStateAsUpdate(olderDoc, newerState);
  }
}

export abstract class IsolatedDocStorageAdapter extends DocStorageAdapter {}
