import { OrganisationInvitationStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { canAssignRole } from './customer-permissions';
import { CreateInvitationDto } from './dto/org.dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CustomerInvitationsService {
  private readonly logger = new Logger(CustomerInvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  async list(actor: AuthenticatedCustomer) {
    await this.expirePending(actor.companyId);
    const invitations = await this.prisma.organisationInvitation.findMany({
      where: { customerId: actor.companyId },
      orderBy: { createdAt: 'desc' },
      include: { invitedBy: { select: { displayName: true, email: true } } },
    });
    return {
      items: invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt.toISOString(),
        acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
        cancelledAt: invitation.cancelledAt?.toISOString() ?? null,
        createdAt: invitation.createdAt.toISOString(),
        invitedBy: {
          displayName: invitation.invitedBy.displayName,
          email: invitation.invitedBy.email,
        },
      })),
      total: invitations.length,
    };
  }

  async invite(
    actor: AuthenticatedCustomer,
    dto: CreateInvitationDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const email = dto.email.trim().toLowerCase();
    if (!canAssignRole(actor.role, dto.role)) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'Cannot invite with this role', 403);
    }

    const existingUser = await this.prisma.customerUser.findUnique({ where: { email } });
    if (existingUser) {
      throw new ApiException(ERROR_CODES.CUSTOMER_MEMBER_EXISTS, 'A user with this email already exists', 409);
    }

    await this.prisma.organisationInvitation.updateMany({
      where: {
        customerId: actor.companyId,
        email,
        status: OrganisationInvitationStatus.PENDING,
      },
      data: { status: OrganisationInvitationStatus.CANCELLED, cancelledAt: new Date() },
    });

    const rawToken = randomBytes(32).toString('hex');
    const invitation = await this.prisma.organisationInvitation.create({
      data: {
        customerId: actor.companyId,
        email,
        role: dto.role,
        tokenHash: this.hashToken(rawToken),
        invitedByUserId: actor.sub,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    });

    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'customer.invitation.created',
      entityType: 'OrganisationInvitation',
      entityId: invitation.id,
      customerId: actor.companyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { email, role: dto.role },
    });

    this.logger.log(`Invitation created for ${email} org=${actor.companyId}`);

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      invitationToken: this.configService.get('NODE_ENV') === 'production' ? undefined : rawToken,
    };
  }

  async cancel(
    actor: AuthenticatedCustomer,
    invitationId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const invitation = await this.requireInvitation(actor.companyId, invitationId);
    if (invitation.status !== OrganisationInvitationStatus.PENDING) {
      throw new ApiException(ERROR_CODES.CUSTOMER_INVITATION_INVALID, 'Only pending invitations can be cancelled', 400);
    }
    await this.prisma.organisationInvitation.update({
      where: { id: invitation.id },
      data: { status: OrganisationInvitationStatus.CANCELLED, cancelledAt: new Date() },
    });
    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'customer.invitation.cancelled',
      entityType: 'OrganisationInvitation',
      entityId: invitation.id,
      customerId: actor.companyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { email: invitation.email },
    });
    return { success: true };
  }

  async resend(
    actor: AuthenticatedCustomer,
    invitationId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const invitation = await this.requireInvitation(actor.companyId, invitationId);
    if (invitation.status !== OrganisationInvitationStatus.PENDING && invitation.status !== OrganisationInvitationStatus.EXPIRED) {
      throw new ApiException(ERROR_CODES.CUSTOMER_INVITATION_INVALID, 'Invitation cannot be resent', 400);
    }

    const rawToken = randomBytes(32).toString('hex');
    const updated = await this.prisma.organisationInvitation.update({
      where: { id: invitation.id },
      data: {
        status: OrganisationInvitationStatus.PENDING,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        cancelledAt: null,
      },
    });

    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'customer.invitation.resent',
      entityType: 'OrganisationInvitation',
      entityId: invitation.id,
      customerId: actor.companyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { email: invitation.email },
    });

    return {
      id: updated.id,
      expiresAt: updated.expiresAt.toISOString(),
      invitationToken: this.configService.get('NODE_ENV') === 'production' ? undefined : rawToken,
    };
  }

  private async requireInvitation(companyId: string, invitationId: string) {
    const invitation = await this.prisma.organisationInvitation.findFirst({
      where: { id: invitationId, customerId: companyId },
    });
    if (!invitation) {
      throw new ApiException(ERROR_CODES.CUSTOMER_INVITATION_NOT_FOUND, 'Invitation not found', 404);
    }
    return invitation;
  }

  private async expirePending(companyId: string): Promise<void> {
    await this.prisma.organisationInvitation.updateMany({
      where: {
        customerId: companyId,
        status: OrganisationInvitationStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: { status: OrganisationInvitationStatus.EXPIRED },
    });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
