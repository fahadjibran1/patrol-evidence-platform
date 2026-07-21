import { INestApplication, ValidationPipe } from '@nestjs/common';
import { LicensePlan, PaymentStatus } from '@prisma/client';
import request from 'supertest';
import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  resetIntegrationDatabase,
  type IntegrationContext,
} from './integration-harness';

describe('Pagination contract and settings signing-key (HTTP)', () => {
  let context: IntegrationContext;
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    context = await createIntegrationContext();
    app = context.module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (context) {
      await closeIntegrationContext(context);
    }
  });

  beforeEach(async () => {
    await resetIntegrationDatabase(context.prisma);
    const admin = await context.prisma.admin.create({
      data: {
        email: context.admin.email,
        passwordHash: context.admin.passwordHash,
        displayName: context.admin.displayName,
        role: context.admin.role,
        isActive: true,
      },
    });
    context.admin = admin;
    context.signingService.useTestKey(context.privateKeyPem, 'integration-test-key');

    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: admin.email, password: 'IntegrationTestPass123!' });

    expect([200, 201]).toContain(login.status);
    const body = login.body as { tokens?: { accessToken?: string } };
    accessToken = body.tokens?.accessToken ?? '';
    expect(accessToken).toBeTruthy();
  });

  it('accepts page/pageSize and returns pagination metadata for customers', async () => {
    await createTestCustomer(context.prisma, { email: 'one@example.com', companyName: 'One Ltd' });
    await createTestCustomer(context.prisma, { email: 'two@example.com', companyName: 'Two Ltd' });

    const response = await request(app.getHttpServer())
      .get('/admin/customers')
      .query({ page: '1', pageSize: '50' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      page: 1,
      pageSize: 50,
      total: 2,
      totalPages: 1,
    });
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.items).toHaveLength(2);
  });

  it('uses the same pagination contract for licences and payments', async () => {
    const customer = await createTestCustomer(context.prisma);

    await context.licencesService.issueImmediately(
      {
        sub: context.admin.id,
        email: context.admin.email,
        role: context.admin.role,
        displayName: context.admin.displayName,
      },
      {
        customerId: customer.id,
        plan: LicensePlan.ANNUAL,
        startsAt: '2026-07-01',
        expiresAt: '2027-06-30',
        maxDevices: 1,
      },
    );

    await context.prisma.paymentRecord.create({
      data: {
        customerId: customer.id,
        amountPence: 12000,
        currency: 'GBP',
        paymentStatus: PaymentStatus.PENDING,
        recordedByAdminId: context.admin.id,
      },
    });

    const licences = await request(app.getHttpServer())
      .get('/admin/licences')
      .query({ page: 1, pageSize: 100 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(licences.body).toMatchObject({
      page: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
    expect(licences.body.items).toHaveLength(1);

    const payments = await request(app.getHttpServer())
      .get('/admin/payments')
      .query({ page: 1, pageSize: 100 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(payments.body).toMatchObject({
      page: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
    expect(payments.body.items).toHaveLength(1);
  });

  it('rejects page below 1 and pageSize above 100', async () => {
    await request(app.getHttpServer())
      .get('/admin/customers')
      .query({ page: 0, pageSize: 25 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);

    await request(app.getHttpServer())
      .get('/admin/customers')
      .query({ page: 1, pageSize: 101 })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('rejects unknown query properties', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/customers')
      .query({ page: 1, pageSize: 25, unexpected: 'nope' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);

    expect(JSON.stringify(response.body)).toMatch(/unexpected|should not exist/i);
  });

  it('returns safe signing-key settings metadata', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/settings/signing-key')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toEqual({
      keyId: 'integration-test-key',
      ready: true,
      algorithm: 'Ed25519',
    });

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/BEGIN (PRIVATE|PUBLIC) KEY/);
    expect(serialized).not.toMatch(/privateKey|publicKeyPem|LICENSE_PRIVATE|encryptionKey|pemPath/i);
    expect(Object.keys(response.body).sort()).toEqual(['algorithm', 'keyId', 'ready']);
  });
});
