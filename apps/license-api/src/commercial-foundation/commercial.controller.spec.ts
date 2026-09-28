import { HttpStatus, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { CommercialController } from './commercial.controller';
import type { CommercialPurchaseService } from './commercial-purchase.service';
import type { CommercialCheckoutService } from './commercial-checkout.service';
import type { CommercialDeliveryService } from './commercial-delivery.service';

async function streamBytes(file: StreamableFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('CommercialController licence delivery', () => {
  const request = {
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('PatrolSafe UAT'),
  } as unknown as Request;

  function harness(download: jest.Mock) {
    const delivery = { download, status: jest.fn() } as unknown as CommercialDeliveryService;
    const controller = new CommercialController(
      { createPurchaseRequest: jest.fn() } as unknown as CommercialPurchaseService,
      { inspectOpaqueReference: jest.fn(), getPublicOrderStatus: jest.fn(), createFromOpaqueReference: jest.fn() } as unknown as CommercialCheckoutService,
      delivery,
    );
    const response = {
      status: jest.fn(),
      setHeader: jest.fn(),
    } as unknown as Response;
    return { controller, response };
  }

  it('returns the exact existing licence bytes for a valid unexpired token', async () => {
    const bytes = Buffer.from('{existing:immutable-signed-licence}', 'utf8');
    const download = jest.fn().mockResolvedValue({
      bytes,
      fileName: 'PatrolSafe-commercial.tglic',
      contentType: 'application/json',
      sha256: 'a'.repeat(64),
    });
    const { controller, response } = harness(download);

    const file = await controller.downloadLicence('V'.repeat(43), request, response);

    expect(file).toBeInstanceOf(StreamableFile);
    expect(await streamBytes(file)).toEqual(bytes);
    expect(download).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('renders a branded no-store page for an expired token without leaking internals', async () => {
    const token = 'E'.repeat(43);
    const download = jest.fn().mockRejectedValue(new ApiException(
      ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_EXPIRED,
      'Licence delivery link has expired.',
      HttpStatus.GONE,
    ));
    const { controller, response } = harness(download);

    const file = await controller.downloadLicence(token, request, response);
    const html = (await streamBytes(file)).toString('utf8');

    expect(response.status).toHaveBeenCalledWith(HttpStatus.GONE);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, max-age=0');
    expect(response.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    expect(html).toContain('PatrolSafe by S4');
    expect(html).toContain('This licence download link has expired');
    expect(html).toContain('Your purchase and licence remain valid.');
    expect(html).toContain('contact PatrolSafe Support');
    expect(html).not.toContain(ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_EXPIRED);
    expect(html).not.toContain(token);
    expect(html).not.toMatch(/opaque purchase|fingerprint|stripe|resend|database|private key|licence contents/i);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('keeps invalid or tampered tokens fail-closed', async () => {
    const error = new ApiException(
      ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_INVALID,
      'Licence delivery link is not valid.',
      HttpStatus.NOT_FOUND,
    );
    const { controller, response } = harness(jest.fn().mockRejectedValue(error));

    await expect(controller.downloadLicence('tampered', request, response)).rejects.toBe(error);
    expect(response.status).not.toHaveBeenCalled();
  });
});
