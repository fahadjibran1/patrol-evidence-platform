import { Injectable } from '@nestjs/common';
import {
  CollectorAdapter,
  NormalizedCollectorEvent,
} from '@/collectors/interfaces/collector-adapter.interface';

@Injectable()
export class GuardAppCollectorAdapter implements CollectorAdapter<Record<string, unknown>> {
  async ingestIncomingMedia(): Promise<void> {
    throw new Error('Guard app ingestion will be implemented in a future phase.');
  }

  async normalizeIncomingEvent(): Promise<NormalizedCollectorEvent> {
    throw new Error('Guard app event normalization will be implemented in a future phase.');
  }

  async downloadMedia(): Promise<Buffer> {
    throw new Error('Guard app media download will be implemented in a future phase.');
  }

  async mapSourceToSite(): Promise<string> {
    throw new Error('Guard app source-site mapping will be implemented in a future phase.');
  }
}
