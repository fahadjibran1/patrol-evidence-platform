import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SimulateLiveImageIngestDto } from './dto/simulate-live-image-ingest.dto';
import { WhatsAppCollectorService } from './whatsapp-collector.service';
import { WhatsAppHelperIngestPayload, WhatsAppHelperRuntimeConfig } from './whatsapp-helper.types';

@Controller('collectors/whatsapp/internal')
export class CollectorsInternalController {
  constructor(private readonly whatsAppCollectorService: WhatsAppCollectorService) {}

  @Get('runtime-config')
  getRuntimeConfig(@Headers('x-patrol-collector-token') token: string): Promise<WhatsAppHelperRuntimeConfig> {
    return this.whatsAppCollectorService.getRuntimeConfig(token);
  }

  @Post('ingest')
  async ingest(
    @Headers('x-patrol-collector-token') token: string,
    @Body() payload: WhatsAppHelperIngestPayload,
    @Req() request: Request,
  ): Promise<{ ok: true; imageId: string; duplicate: boolean; filePath?: string }> {
    return this.whatsAppCollectorService.ingestFromHelper(token, payload, {
      contentLength: request.headers['content-length'],
    });
  }

  @Post('simulate-live-image')
  async simulateLiveImage(
    @Headers('x-patrol-collector-token') token: string,
    @Body() payload: SimulateLiveImageIngestDto,
  ): Promise<{ ok: true; imageId: string; duplicate: boolean }> {
    return this.whatsAppCollectorService.simulateLiveImageIngest(token, payload);
  }
}
