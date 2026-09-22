import { Body, Controller, Get, Headers, Param, Post, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CommercialPurchaseService } from './commercial-purchase.service';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { PurchaseRequestV2Dto } from './dto/purchase-request-v2.dto';
import { CommercialCheckoutDto } from './dto/commercial-checkout.dto';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { CommercialDeliveryService } from './commercial-delivery.service';

@Controller('commercial')
export class CommercialController {
  constructor(
    private readonly purchases: CommercialPurchaseService,
    private readonly checkout: CommercialCheckoutService,
    private readonly delivery: CommercialDeliveryService,
  ) {}

  @Post('purchase-requests')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  createPurchaseRequest(@Body() body: PurchaseRequestV2Dto) {
    return this.purchases.createPurchaseRequest(body);
  }

  @Get('purchase')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  inspectPurchase(@Headers('authorization') authorization?: string) {
    return this.checkout.inspectOpaqueReference(this.bearer(authorization));
  }

  @Post('checkout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createCheckout(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: CommercialCheckoutDto,
  ) {
    return this.checkout.createFromOpaqueReference(this.bearer(authorization), body);
  }

  @Get('licence/status/:token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  licenceStatus(@Param('token') token: string) {
    return this.delivery.status(token);
  }

  @Get('licence/download/:token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async downloadLicence(@Param('token') token: string, @Req() request: Request) {
    const result = await this.delivery.download(token, { ipAddress: request.ip, userAgent: request.get('user-agent') });
    return new StreamableFile(result.bytes, { type: result.contentType, disposition: `attachment; filename="${result.fileName}"`, length: result.bytes.byteLength });
  }

  private bearer(authorization?: string): string {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
    if (!match) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_INVALID, 'Purchase reference is not valid.', 404);
    }
    return match[1];
  }
}
