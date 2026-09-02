import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // rawBody: true preserves exact bytes for Stripe webhook signature verification.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  const adminPortalOrigin = configService.get<string>('LICENSE_PORTAL_ORIGIN') ?? 'http://localhost:5174';
  const customerPortalOrigin =
    configService.get<string>('CUSTOMER_PORTAL_ORIGIN') ?? 'http://localhost:5175';
  const allowedOrigins = [...new Set([adminPortalOrigin, customerPortalOrigin])];

  app.use(helmet());

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const swaggerExplicitlyEnabled =
    String(configService.get<string | boolean>('LICENSE_API_ENABLE_SWAGGER') ?? '').toLowerCase() === 'true';
  const swaggerEnabled = nodeEnv !== 'production' || swaggerExplicitlyEnabled;

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Patrol Licence Administration API')
      .setDescription('Private API for managing TG1 licence records, customers, and payments')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();

    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  app.enableShutdownHooks();

  const port = configService.get<number>('PORT') ?? configService.get<number>('LICENSE_API_PORT') ?? 3010;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
