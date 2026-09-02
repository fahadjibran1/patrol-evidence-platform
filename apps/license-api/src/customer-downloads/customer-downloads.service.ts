import { Injectable } from '@nestjs/common';
import { LicenseStatus } from '@prisma/client';
import { CustomerPermission } from '@/customer-org/customer-permissions';
import { PrismaService } from '@/prisma/prisma.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { deriveEffectiveStatus } from '@/licences/licence.util';
import { roleHasPermission } from '@/customer-org/customer-permissions';

export interface CustomerLicenceDownloadResult {
  fileName: string;
  contentType: string;
  body: string;
  licenceId: string;
  licenseId: string;
}

@Injectable()
export class CustomerDownloadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
  ) {}

  async downloadCurrentActive(
    actor: AuthenticatedCustomer,
    licenceId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<CustomerLicenceDownloadResult> {
    if (!roleHasPermission(actor.role, CustomerPermission.DOWNLOAD_LICENCE)) {
      throw new ApiException(
        ERROR_CODES.CUSTOMER_PERMISSION_DENIED,
        'Your role cannot download licence files',
        403,
      );
    }

    const licence = await this.prisma.licence.findFirst({
      where: { id: licenceId, customerId: actor.companyId },
    });

    if (!licence) {
      throw new ApiException(ERROR_CODES.LICENCE_NOT_FOUND, 'Licence not found', 404);
    }

    const effective = deriveEffectiveStatus(licence);
    const downloadable =
      licence.status === LicenseStatus.ACTIVE
      && (effective === 'ACTIVE' || effective === 'EXPIRING_SOON' || effective === 'SCHEDULED');

    if (!downloadable) {
      throw new ApiException(
        ERROR_CODES.CUSTOMER_LICENCE_DOWNLOAD_FORBIDDEN,
        'Only the current active licence can be downloaded',
        403,
      );
    }

    if (!licence.signedLicenseEnc) {
      throw new ApiException(
        ERROR_CODES.CUSTOMER_LICENCE_NOT_DOWNLOADABLE,
        'Licence file is not available for download',
        404,
      );
    }

    const body = this.encryptionService.decrypt(licence.signedLicenseEnc);

    const updated = await this.prisma.licence.update({
      where: { id: licence.id },
      data: {
        downloadCount: { increment: 1 },
        lastDownloadedAt: new Date(),
      },
    });

    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'customer.licence.downloaded',
      entityType: 'Licence',
      entityId: licence.id,
      customerId: actor.companyId,
      licenceId: licence.id,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        licenseId: licence.licenseId,
        downloadCount: updated.downloadCount,
        source: 'customer-portal',
      },
    });

    return {
      fileName: `${licence.licenseId}.lic`,
      contentType: 'application/octet-stream',
      body,
      licenceId: licence.id,
      licenseId: licence.licenseId,
    };
  }
}
