import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { toCustomerSafeLicence } from '@/customer-portal/customer-portal.util';

@Injectable()
export class CustomerLicencesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedCustomer) {
    const licences = await this.prisma.licence.findMany({
      where: { customerId: actor.companyId },
      include: { currentVersion: true },
      orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }],
    });
    return {
      items: licences.map(toCustomerSafeLicence),
      total: licences.length,
    };
  }

  async getOne(actor: AuthenticatedCustomer, id: string) {
    const licence = await this.prisma.licence.findFirst({
      where: { id, customerId: actor.companyId },
      include: { currentVersion: true },
    });
    if (!licence) {
      throw new ApiException(ERROR_CODES.LICENCE_NOT_FOUND, 'Licence not found', 404);
    }
    return toCustomerSafeLicence(licence);
  }
}
