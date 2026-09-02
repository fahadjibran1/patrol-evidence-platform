import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerPermission } from '@/customer-org/customer-permissions';
import { CustomerJwtAuthGuard } from '@/customer-auth/guards/customer-jwt-auth.guard';
import { CustomerPermissionsGuard } from '@/customer-auth/guards/customer-permissions.guard';
import { CurrentCustomer } from '@/customer-auth/decorators/current-customer.decorator';
import { RequireCustomerPermissions } from '@/customer-auth/decorators/require-customer-permissions.decorator';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { CustomerOrgProfileService } from '@/customer-org/customer-org-profile.service';

@ApiTags('customer-profile')
@ApiBearerAuth()
@UseGuards(CustomerJwtAuthGuard, CustomerPermissionsGuard)
@Controller('customer/profile')
export class CustomerProfileController {
  constructor(private readonly orgProfileService: CustomerOrgProfileService) {}

  @Get()
  @RequireCustomerPermissions(CustomerPermission.MANAGE_OWN_PROFILE)
  getProfile(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.orgProfileService.getOrganisation(customer);
  }
}
