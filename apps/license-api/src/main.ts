import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const portalOrigin = configService.get<string>('LICENSE_PORTAL_ORIGIN') ?? 'http://localhost:5174';

  app.enableCors({
    origin: portalOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Patrol Licence Administration API')
    .setDescription('Private API for managing TG1 licence records, customers, and payments')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT') ?? configService.get<number>('LICENSE_API_PORT') ?? 3010;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
