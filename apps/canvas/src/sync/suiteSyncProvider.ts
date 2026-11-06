import { SuiteSyncClient, type SuiteSyncStatus, type WebSocketConstructor } from "@suite/sync/loro";
import type { LoroDoc } from "loro-crdt";
import type { ConnectionStatus } from "../store/useCanvasStore";

export interface SuiteSyncProviderOptions {
  readonly url: string;
  readonly workspaceId: string;
  readonly memberId: string;
  readonly deviceId: string;
  readonly epoch: number;
  readonly doc: LoroDoc;
  readonly onStatus?: (status: ConnectionStatus) => void;
  readonly onSynced?: () => void;
  /** Injectable for tests; the app uses the platform WebSocket. */
  readonly webSocket?: WebSocketConstructor;
}

/**
 * The dev `suite-sync` transport, behind the same small shape the store expects.
 *
 * It has no presence channel yet: the first phase is document sync. The store
 * passes the same `LoroDoc` it persists, so a remote update is saved by the
 * same local adapter as a typed edit.
 */
export class SuiteSyncProvider {
  readonly client: SuiteSyncClient;

  constructor(options: SuiteSyncProviderOptions) {
    this.client = new SuiteSyncClient({
      url: options.url,
      workspaceId: options.workspaceId,
      memberId: options.memberId,
      deviceId: options.deviceId,
      epoch: options.epoch,
      doc: options.doc,
      ...(options.onStatus === undefined
        ? {}
        : { onStatus: (status: SuiteSyncStatus) => options.onStatus?.(mapStatus(status)) }),
      ...(options.onSynced === undefined ? {} : { onSynced: options.onSynced }),
      ...(options.webSocket === undefined ? {} : { WebSocket: options.webSocket }),
    });
    void this.client.connect();
  }

  get status(): ConnectionStatus {
    return mapStatus(this.client.status);
  }

  connect(): Promise<void> {
    return this.client.connect();
  }

  rejoin(): Promise<void> {
    return this.client.rejoin();
  }

  flush(): Promise<void> {
    return this.client.flush();
  }

  dispose(): void {
    this.client.dispose();
  }
}

function mapStatus(status: SuiteSyncStatus): ConnectionStatus {
  return status;
}
