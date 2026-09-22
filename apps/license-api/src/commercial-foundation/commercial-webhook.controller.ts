import { Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { CommercialWebhookService } from './commercial-webhook.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

@ApiExcludeController()
@Controller('commercial/webhooks')
export class CommercialWebhookController {
  constructor(private readonly webhooks: CommercialWebhookService) {}

  @Post('stripe')
  @SkipThrottle()
  @HttpCode(200)
  stripe(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!request.rawBody) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_WEBHOOK_INVALID, 'Raw webhook body is required.', 400);
    }
    return this.webhooks.ingest(request.rawBody, signature);
  }
}
