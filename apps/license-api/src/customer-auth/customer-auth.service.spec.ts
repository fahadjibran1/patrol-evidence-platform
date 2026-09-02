import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CustomerRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerTokenService } from './customer-token.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';

describe('CustomerAuthService', () => {
  let service: CustomerAuthService;
  let prisma: {
    customerUser: { findUnique: jest.Mock; update: jest.Mock; findUniqueOrThrow: jest.Mock };
    customerRefreshToken: { create: jest.Mock; findUnique: jest.Mock; delete: jest.Mock; deleteMany: jest.Mock };
    customerSession: { create: jest.Mock; updateMany: jest.Mock };
    customerPasswordResetToken: { create: jest.Mock; findUnique: jest.Mock };
  };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customerUser: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      customerRefreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      customerSession: {
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      customerPasswordResetToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    audit = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
              JWT_ACCESS_EXPIRES_IN: '15m',
              JWT_REFRESH_EXPIRES_IN: '7d',
              NODE_ENV: 'test',
            }),
          ],
        }),
        JwtModule.register({ secret: 'test-secret-at-least-32-characters-long!!' }),
      ],
      providers: [
        CustomerAuthService,
        CustomerTokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(CustomerAuthService);
  });

  it('logs in with role and remember-me session', async () => {
    const passwordHash = await bcrypt.hash('CustomerPass123!', 4);
    prisma.customerUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@acme.test',
      passwordHash,
      displayName: 'Acme User',
      customerId: 'cust-1',
      role: CustomerRole.OWNER,
      emailVerifiedAt: new Date(),
      isActive: true,
      customer: { status: 'ACTIVE' },
    });
    prisma.customerUser.update.mockResolvedValue({});
    prisma.customerUser.findUniqueOrThrow.mockResolvedValue({
      id: 'user-1',
      email: 'user@acme.test',
      displayName: 'Acme User',
      customerId: 'cust-1',
      role: CustomerRole.OWNER,
      emailVerifiedAt: new Date(),
    });
    prisma.customerRefreshToken.create.mockResolvedValue({ id: 'rt-1' });
    prisma.customerSession.create.mockResolvedValue({});

    const result = await service.login(
      { email: 'user@acme.test', password: 'CustomerPass123!', rememberMe: true },
      { ipAddress: '127.0.0.1' },
    );

    expect(result.customer.role).toBe(CustomerRole.OWNER);
    expect(result.tokens.rememberMe).toBe(true);
    expect(prisma.customerSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rememberMe: true }) }),
    );
  });

  it('issues a password reset token for active users', async () => {
    prisma.customerUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@acme.test',
      isActive: true,
      customerId: 'cust-1',
    });
    prisma.customerPasswordResetToken.create.mockResolvedValue({});

    const result = await service.requestPasswordReset({ email: 'user@acme.test' });
    expect(result.accepted).toBe(true);
    expect(result.resetToken).toBeTruthy();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'customer.auth.password_reset_requested' }),
    );
  });
});
