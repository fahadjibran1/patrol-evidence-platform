import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { EmailProvider } from './email.provider';

const sendMail = jest.fn();
const createTransport = jest.fn().mockImplementation(() => ({ sendMail }));

jest.mock('nodemailer', () => ({
  createTransport: (options: unknown) => createTransport(options),
}));

describe('EmailProvider', () => {
  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
    sendMail.mockResolvedValue({ messageId: 'smtp-message-1' });
  });

  function createProvider(env: Record<string, string | number | undefined>): EmailProvider {
    return new EmailProvider({
      get: (key: string) => env[key],
    } as ConfigService);
  }

  it('supports email notification types', () => {
    const provider = createProvider({});
    expect(provider.supports(NotificationType.LICENSE_ISSUED)).toBe(true);
    expect(provider.kind).toBe('EMAIL');
  });

  it('returns null config when SMTP settings are incomplete', () => {
    const provider = createProvider({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
    });
    expect(provider.getSmtpConfig()).toBeNull();
    expect(() => provider.assertConfigured()).toThrow(/SMTP is not configured/i);
  });

  it('parses valid SMTP configuration', () => {
    const provider = createProvider({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_USERNAME: 'mailer',
      SMTP_PASSWORD: 'secret',
      SMTP_SECURE: 'false',
      SMTP_FROM_NAME: 'Patrol Licences',
      SMTP_FROM_EMAIL: 'licences@example.com',
    });

    expect(provider.getSmtpConfig()).toEqual({
      host: 'smtp.example.com',
      port: 587,
      username: 'mailer',
      password: 'secret',
      secure: false,
      fromName: 'Patrol Licences',
      fromEmail: 'licences@example.com',
    });
  });

  it('sends mail through nodemailer when configured', async () => {
    const provider = createProvider({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_USERNAME: 'mailer',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM_EMAIL: 'licences@example.com',
      SMTP_FROM_NAME: 'Patrol Licences',
    });

    const result = await provider.send({
      to: 'customer@example.com',
      subject: 'Licence issued',
      html: '<p>Hello</p>',
      text: 'Hello',
      notificationType: NotificationType.LICENSE_ISSUED,
      attachments: [
        {
          filename: 'PEL-2026-000001.lic',
          content: 'TG1.payload.signature\n',
          contentType: 'text/plain; charset=utf-8',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('smtp-message-1');
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        auth: { user: 'mailer', pass: 'secret' },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        subject: 'Licence issued',
        html: '<p>Hello</p>',
        text: 'Hello',
        attachments: [
          {
            filename: 'PEL-2026-000001.lic',
            content: 'TG1.payload.signature\n',
            contentType: 'text/plain; charset=utf-8',
          },
        ],
      }),
    );
  });

  it('returns safe SMTP status without credentials', () => {
    const provider = createProvider({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_USERNAME: 'mailer',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM_EMAIL: 'licences@example.com',
      SMTP_FROM_NAME: 'Patrol Licences',
      SMTP_SECURE: 'false',
    });

    expect(provider.getSafeStatus()).toEqual({
      configured: true,
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      fromName: 'Patrol Licences',
      fromEmail: 'licences@example.com',
    });
  });

  it('returns failure when SMTP is missing instead of throwing from send()', async () => {
    const provider = createProvider({});
    const result = await provider.send({
      to: 'customer@example.com',
      subject: 'Licence issued',
      html: '<p>Hello</p>',
      text: 'Hello',
      notificationType: NotificationType.LICENSE_ISSUED,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/SMTP is not configured/i);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
