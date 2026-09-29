import { LicenseController } from './license.controller';
import { CommercialPurchaseClientService } from './commercial-purchase-client.service';
import { LicenseService } from './license.service';

describe('LicenseController commercial purchase diagnostics', () => {
  it('logs controller entry before delegating without logging the request values', async () => {
    const commercialPurchase = {
      start: jest.fn(async () => ({ status: 'PURCHASE_STARTED' })),
    } as unknown as CommercialPurchaseClientService;
    const controller = new LicenseController({} as LicenseService, commercialPurchase);
    const logger = (controller as unknown as { logger: { log: (message: string) => void } }).logger;
    const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    const dto = {
      requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213',
      clientNonce: 'SECRET_NONCE_MUST_NOT_BE_LOGGED_12345',
    };

    await controller.startCommercialPurchase(dto);

    expect(commercialPurchase.start).toHaveBeenCalledWith(dto);
    expect(log).toHaveBeenCalledWith(
      'COMMERCIAL_PURCHASE_DIAGNOSTIC stage=COMMERCIAL_PURCHASE_CONTROLLER_ENTERED',
    );
    expect(log.mock.calls.flat().join(' ')).not.toContain(dto.requestId);
    expect(log.mock.calls.flat().join(' ')).not.toContain(dto.clientNonce);
  });
});
