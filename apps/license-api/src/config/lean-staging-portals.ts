import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import express, { type Request, type Response } from 'express';
import { existsSync } from 'fs';
import { resolve } from 'path';

export interface LeanStagingPortalPaths {
  customerRoot: string;
  operatorRoot: string;
}

export function leanStagingPortalPaths(cwd = process.cwd()): LeanStagingPortalPaths {
  return {
    customerRoot: resolve(cwd, 'public', 'customer'),
    operatorRoot: resolve(cwd, 'public', 'operator'),
  };
}

export function configureLeanStagingPortals(
  app: INestApplication,
  config: ConfigService,
  paths = leanStagingPortalPaths(),
): void {
  if (String(config.get<string>('COMMERCIAL_LEAN_STAGING_PORTALS') ?? '').toLowerCase() !== 'true') return;
  if (String(config.get<string>('PATROLSAFE_COMMERCIAL_STAGING') ?? '').toLowerCase() !== 'true') {
    throw new Error('Lean staging portals require the explicit commercial staging marker.');
  }
  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error('Lean staging portals cannot be enabled in production.');
  }
  const customerIndex = resolve(paths.customerRoot, 'index.html');
  const operatorIndex = resolve(paths.operatorRoot, 'index.html');
  if (!existsSync(customerIndex) || !existsSync(operatorIndex)) {
    throw new Error('Lean staging portal assets are missing.');
  }

  const server = app.getHttpAdapter().getInstance();
  server.use('/operator', express.static(paths.operatorRoot, { index: false, fallthrough: true }));
  server.get(/^\/operator(?:\/.*)?$/, (_request: Request, response: Response) => response.sendFile(operatorIndex));
  server.use(express.static(paths.customerRoot, { index: false, fallthrough: true }));
  server.get('/', (_request: Request, response: Response) => response.sendFile(customerIndex));
  server.get(
    /^\/patrolsafe\/(?:buy|licence\/status)(?:\/.*)?$/,
    (_request: Request, response: Response) => response.sendFile(customerIndex),
  );
}
