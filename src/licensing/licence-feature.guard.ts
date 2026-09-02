import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { LicenceFeatures } from '@patrol/license-core';
import { LicenceEvaluationService } from './licence-evaluation.service';

export const LICENCE_FEATURE_KEY = 'licenceFeature';
export const RequireLicenceFeature = (feature: keyof LicenceFeatures) =>
  SetMetadata(LICENCE_FEATURE_KEY, feature);

@Injectable()
export class LicenceFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly evaluationService: LicenceEvaluationService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<keyof LicenceFeatures | undefined>(
      LICENCE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!feature) {
      return true;
    }

    try {
      this.evaluationService.assertFeature(feature);
      return true;
    } catch (error) {
      throw new ForbiddenException(error instanceof Error ? error.message : 'Licence feature denied.');
    }
  }
}
