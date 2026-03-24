import { CollectorAdapter, NormalizedCollectorEvent } from '@/collectors/interfaces/collector-adapter.interface';
export declare class GuardAppCollectorAdapter implements CollectorAdapter<Record<string, unknown>> {
    ingestIncomingMedia(): Promise<void>;
    normalizeIncomingEvent(): Promise<NormalizedCollectorEvent>;
    downloadMedia(): Promise<Buffer>;
    mapSourceToSite(): Promise<string>;
}
