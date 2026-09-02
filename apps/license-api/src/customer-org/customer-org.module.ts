import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '@/customer-auth/customer-auth.module';
import { CustomerOrgController } from './customer-org.controller';
import { CustomerMembersService } from './customer-members.service';
import { CustomerInvitationsService } from './customer-invitations.service';
import { CustomerSessionsService } from './customer-sessions.service';
import { CustomerActivityService } from './customer-activity.service';
import { CustomerOrgProfileService } from './customer-org-profile.service';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerOrgController],
  providers: [
    CustomerMembersService,
    CustomerInvitationsService,
    CustomerSessionsService,
    CustomerActivityService,
    CustomerOrgProfileService,
  ],
  exports: [
    CustomerMembersService,
    CustomerInvitationsService,
    CustomerSessionsService,
    CustomerActivityService,
    CustomerOrgProfileService,
  ],
})
export class CustomerOrgModule {}
