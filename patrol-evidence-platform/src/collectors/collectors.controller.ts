import type { Express } from 'express';
import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { WhatsAppCollectorAdapter } from './adapters/whatsapp-collector.adapter';
import { MockWhatsAppImageDto } from './dto/mock-whatsapp-image.dto';

@Controller('collectors/whatsapp')
export class CollectorsController {
  constructor(private readonly whatsappCollectorAdapter: WhatsAppCollectorAdapter) {}

  @Post('mock-image')
  @UseInterceptors(FileInterceptor('file'))
  async mockImage(@Body() dto: MockWhatsAppImageDto, @UploadedFile() file: Express.Multer.File) {
    await this.whatsappCollectorAdapter.simulateIncomingImage({
      groupName: dto.groupName,
      senderName: dto.senderName,
      senderNumber: dto.senderNumber,
      timestamp: dto.timestamp ? Math.floor(new Date(dto.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000),
      messageId: `mock-${Date.now()}`,
      media: {
        mimeType: file?.mimetype ?? 'image/jpeg',
        fileName: file?.originalname,
        data: file?.buffer ?? Buffer.alloc(0),
      },
    });

    return { status: 'ok' };
  }
}
