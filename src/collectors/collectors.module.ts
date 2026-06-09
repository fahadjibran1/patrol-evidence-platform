import { Module } from '@nestjs/common';
import { LicensingModule } from '@/licensing/licensing.module';
import { PatrolGroupsModule } from '@/patrol-groups/patrol-groups.module';
import { PatrolImagesModule } from '@/patrol-images/patrol-images.module';
import { CollectorsController } from './collectors.controller';
import { CollectorsInternalController } from './collectors.internal.controller';
import { WhatsAppCollectorService } from './whatsapp-collector.service';

@Module({
  imports: [PatrolGroupsModule, PatrolImagesModule, LicensingModule],
  controllers: [CollectorsController, CollectorsInternalController],
  providers: [WhatsAppCollectorService],
  exports: [WhatsAppCollectorService],
})
export class CollectorsModule {}
