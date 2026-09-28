import { Body, Controller, Get, Headers, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CommercialPurchaseService } from './commercial-purchase.service';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { PurchaseRequestV2Dto } from './dto/purchase-request-v2.dto';
import { CommercialCheckoutDto } from './dto/commercial-checkout.dto';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { CommercialDeliveryService } from './commercial-delivery.service';
import { COMMERCIAL_EXPIRED_DOWNLOAD_PAGE } from './commercial-expired-download-page';

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

  @Get('orders/:publicOrderId/status')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  publicOrderStatus(@Param('publicOrderId') publicOrderId: string) {
    return this.checkout.getPublicOrderStatus(publicOrderId);
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
  async downloadLicence(
    @Param('token') token: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.delivery.download(token, { ipAddress: request.ip, userAgent: request.get('user-agent') });
      return new StreamableFile(result.bytes, { type: result.contentType, disposition: `attachment; filename="${result.fileName}"`, length: result.bytes.byteLength });
    } catch (error) {
      if (!(error instanceof ApiException) || error.code !== ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_EXPIRED) throw error;
      const page = Buffer.from(COMMERCIAL_EXPIRED_DOWNLOAD_PAGE, 'utf8');
      response.status(410);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
      return new StreamableFile(page, { type: 'text/html; charset=utf-8', disposition: 'inline', length: page.byteLength });
    }
  }

  private bearer(authorization?: string): string {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
    if (!match) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_INVALID, 'Purchase reference is not valid.', 404);
    }
    return match[1];
  }
}
