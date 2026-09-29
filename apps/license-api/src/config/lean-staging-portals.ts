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
  const stagingEnabled = String(config.get<string>('COMMERCIAL_LEAN_STAGING_PORTALS') ?? '').toLowerCase() === 'true';
  const productionEnabled = String(config.get<string>('COMMERCIAL_EMBEDDED_PORTALS') ?? '').toLowerCase() === 'true';
  if (!stagingEnabled && !productionEnabled) return;
  if (stagingEnabled) {
    if (String(config.get<string>('PATROLSAFE_COMMERCIAL_STAGING') ?? '').toLowerCase() !== 'true') {
      throw new Error('Lean staging portals require the explicit commercial staging marker.');
    }
    if (config.get<string>('NODE_ENV') === 'production') {
      throw new Error('Lean staging portals cannot be enabled in production.');
    }
  }
  if (productionEnabled && (config.get<string>('NODE_ENV') !== 'production' || stagingEnabled)) {
    throw new Error('Embedded production portals require production mode without staging portal flags.');
  }
  const customerIndex = resolve(paths.customerRoot, 'index.html');
  const operatorIndex = resolve(paths.operatorRoot, 'index.html');
  if (!existsSync(customerIndex) || !existsSync(operatorIndex)) {
    throw new Error('Commercial portal assets are missing.');
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
