import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import {
  closeIntegrationContext,
  createIntegrationContext,
  resetIntegrationDatabase,
  type IntegrationContext,
} from './integration-harness';

describe('commercial operator authorization (HTTP)', () => {
  let context: IntegrationContext;
  let app: INestApplication;

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
    if (app) await app.close();
    if (context) await closeIntegrationContext(context);
  });

  beforeEach(async () => {
    await resetIntegrationDatabase(context.prisma);
    context.admin = await context.prisma.admin.create({
      data: {
        email: context.admin.email,
        passwordHash: context.admin.passwordHash,
        displayName: context.admin.displayName,
        role: context.admin.role,
        isActive: true,
      },
    });
  });

  it('allows an authenticated SUPER_ADMIN to load the commercial approval queue', async () => {
    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: context.admin.email, password: 'IntegrationTestPass123!' });

    expect([200, 201]).toContain(login.status);
    const accessToken = (login.body as { tokens?: { accessToken?: string } }).tokens?.accessToken;
    expect(accessToken).toBeTruthy();

    const response = await request(app.getHttpServer())
      .get('/admin/commercial/approvals')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toEqual([]);
  });
});
