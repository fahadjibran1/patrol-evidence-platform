import { Module } from '@nestjs/common';
import { CollectorsController } from './collectors.controller';
import { WhatsAppCollectorAdapter } from './adapters/whatsapp-collector.adapter';
import { GuardAppCollectorAdapter } from './adapters/guard-app-collector.adapter';
import { PatrolImagesModule } from '@/patrol-images/patrol-images.module';

@Module({
  imports: [PatrolImagesModule],
  providers: [WhatsAppCollectorAdapter, GuardAppCollectorAdapter],
  controllers: [CollectorsController],
  exports: [WhatsAppCollectorAdapter, GuardAppCollectorAdapter],
})
export class CollectorsModule {}
