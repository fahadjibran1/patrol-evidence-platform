import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  WhatsAppCollectorContact,
  WhatsAppCollectorGroup,
  WhatsAppCollectorService,
  WhatsAppCollectorStatus,
  WhatsAppCertificationAuthorizationResult,
} from './whatsapp-collector.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { ManualBackfillDto } from './dto/manual-backfill.dto';
import { SendTestImageDto } from './dto/send-test-image.dto';
import { SimulateLiveImageIngestDto } from './dto/simulate-live-image-ingest.dto';
import { LicenceFeatureGuard, RequireLicenceFeature } from '@/licensing/licence-feature.guard';

@Controller('collectors/whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard, LicenceFeatureGuard)
@Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
export class CollectorsController {
  constructor(private readonly whatsAppCollectorService: WhatsAppCollectorService) {}

  @Get('status')
  getStatus(): Promise<WhatsAppCollectorStatus> {
    return this.whatsAppCollectorService.getStatus();
  }

  @Get('groups')
  @RequireLicenceFeature('whatsappMonitoring')
  groups(): Promise<WhatsAppCollectorGroup[]> {
    return this.whatsAppCollectorService.listGroups();
  }

  @Get('contacts')
  @RequireLicenceFeature('whatsappMonitoring')
  contacts(): Promise<WhatsAppCollectorContact[]> {
    return this.whatsAppCollectorService.listContacts();
  }

  @Post('start')
  @RequireLicenceFeature('whatsappMonitoring')
  start(): Promise<WhatsAppCollectorStatus> {
    return this.whatsAppCollectorService.start();
  }

  @Post('stop')
  stop(): Promise<WhatsAppCollectorStatus> {
    return this.whatsAppCollectorService.stop();
  }

  @Post('certification/authorize-authentication')
  @RequireLicenceFeature('whatsappMonitoring')
  authorizeCertificationAuthentication(): Promise<WhatsAppCertificationAuthorizationResult> {
    return this.whatsAppCollectorService.authorizeCertificationAuthentication();
  }

  @Post('reset-session')
  @RequireLicenceFeature('whatsappMonitoring')
  resetSession(): Promise<WhatsAppCollectorStatus> {
    return this.whatsAppCollectorService.resetSession();
  }

  @Post('fresh-profile')
  @RequireLicenceFeature('whatsappMonitoring')
  createFreshWhatsAppProfile(): Promise<WhatsAppCollectorStatus> {
    return this.whatsAppCollectorService.createFreshWhatsAppProfile();
  }

  @Post('backfill')
  @RequireLicenceFeature('whatsappMonitoring')
  backfill(@Body() dto: ManualBackfillDto): Promise<WhatsAppCollectorStatus> {
    return this.whatsAppCollectorService.manualBackfill(dto.hours);
  }

  @Post('test-send')
  @RequireLicenceFeature('whatsappMonitoring')
  testSend(@Body() dto: SendTestImageDto): Promise<WhatsAppCollectorStatus> {
    return this.whatsAppCollectorService.sendTestImage(dto.groupId);
  }

  @Post('refresh-sources')
  @RequireLicenceFeature('whatsappMonitoring')
  refreshSources(): Promise<WhatsAppCollectorStatus> {
    return this.whatsAppCollectorService.refreshDiscoveredChats();
  }

  @Post('probe-auth-ready-lifecycle')
  @RequireLicenceFeature('whatsappMonitoring')
  probeAuthReadyLifecycle(): Promise<WhatsAppCollectorStatus> {
    return this.whatsAppCollectorService.probeAuthReadyLifecycle();
  }

  @Post('simulate-live-image')
  @RequireLicenceFeature('whatsappMonitoring')
  simulateLiveImage(
    @Body() dto: SimulateLiveImageIngestDto,
  ): Promise<{ ok: true; imageId: string; duplicate: boolean }> {
    return this.whatsAppCollectorService.simulateLiveImageIngestForAdmin(dto);
  }
}
