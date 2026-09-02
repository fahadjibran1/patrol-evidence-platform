import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { NotificationProviderKind, NotificationType } from '@prisma/client';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type {
  NotificationMessage,
  NotificationProvider,
  NotificationSendResult,
} from '../interfaces/notification-provider.interface';

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
  fromName: string;
  fromEmail: string;
}

export interface SmtpStatusResponse {
  configured: boolean;
  host: string | null;
  port: number | null;
  secure: boolean | null;
  fromName: string | null;
  fromEmail: string | null;
}

@Injectable()
export class EmailProvider implements NotificationProvider {
  readonly kind = NotificationProviderKind.EMAIL;
  private transporter: Transporter | null = null;
  private transporterFingerprint: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  supports(notificationType: NotificationType): boolean {
    return Object.values(NotificationType).includes(notificationType);
  }

  getSmtpConfig(): SmtpConfig | null {
    const host = this.configService.get<string>('SMTP_HOST')?.trim();
    const portRaw = this.configService.get<string | number>('SMTP_PORT');
    const username = this.configService.get<string>('SMTP_USERNAME')?.trim();
    const password = this.configService.get<string>('SMTP_PASSWORD');
    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL')?.trim();
    const fromName = this.configService.get<string>('SMTP_FROM_NAME')?.trim() || 'Patrol Licence Portal';
    const secureRaw = this.configService.get<string | boolean>('SMTP_SECURE');

    if (!host || !portRaw || !username || password === undefined || password === null || !fromEmail) {
      return null;
    }

    const port = typeof portRaw === 'number' ? portRaw : Number(portRaw);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return null;
    }

    const secure =
      typeof secureRaw === 'boolean'
        ? secureRaw
        : String(secureRaw ?? 'false').toLowerCase() === 'true';

    return {
      host,
      port,
      username,
      password: String(password),
      secure,
      fromName,
      fromEmail,
    };
  }

  getSafeStatus(): SmtpStatusResponse {
    const config = this.getSmtpConfig();
    if (!config) {
      return {
        configured: false,
        host: this.configService.get<string>('SMTP_HOST')?.trim() || null,
        port: this.parseOptionalPort(this.configService.get<string | number>('SMTP_PORT')),
        secure: this.parseOptionalSecure(this.configService.get<string | boolean>('SMTP_SECURE')),
        fromName: this.configService.get<string>('SMTP_FROM_NAME')?.trim() || null,
        fromEmail: this.configService.get<string>('SMTP_FROM_EMAIL')?.trim() || null,
      };
    }

    return {
      configured: true,
      host: config.host,
      port: config.port,
      secure: config.secure,
      fromName: config.fromName,
      fromEmail: config.fromEmail,
    };
  }

  assertConfigured(): SmtpConfig {
    const config = this.getSmtpConfig();
    if (!config) {
      throw new ApiException(
        ERROR_CODES.NOTIFICATION_SMTP_NOT_CONFIGURED,
        'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL.',
        503,
      );
    }
    return config;
  }

  async send(message: NotificationMessage): Promise<NotificationSendResult> {
    try {
      const smtp = this.assertConfigured();
      const transporter = this.getTransporter(smtp);
      const info = await transporter.sendMail({
        from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
        })),
      });

      return {
        success: true,
        providerMessageId: typeof info.messageId === 'string' ? info.messageId : undefined,
      };
    } catch (error) {
      if (error instanceof ApiException) {
        const response = error.getResponse();
        const messageText =
          typeof response === 'object' && response !== null && 'message' in response
            ? String((response as { message: string }).message)
            : error.message;
        return {
          success: false,
          errorMessage: messageText,
          errorCode: error.code,
        };
      }

      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Email delivery failed',
        errorCode: ERROR_CODES.NOTIFICATION_SEND_FAILED,
      };
    }
  }

  private getTransporter(smtp: SmtpConfig): Transporter {
    const fingerprint = `${smtp.host}|${smtp.port}|${smtp.username}|${smtp.secure}`;
    if (!this.transporter || this.transporterFingerprint !== fingerprint) {
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.username,
          pass: smtp.password,
        },
      });
      this.transporterFingerprint = fingerprint;
    }
    return this.transporter;
  }

  private parseOptionalPort(portRaw: string | number | undefined): number | null {
    if (portRaw === undefined || portRaw === null || portRaw === '') {
      return null;
    }
    const port = typeof portRaw === 'number' ? portRaw : Number(portRaw);
    return Number.isFinite(port) ? port : null;
  }

  private parseOptionalSecure(secureRaw: string | boolean | undefined): boolean | null {
    if (secureRaw === undefined || secureRaw === null || secureRaw === '') {
      return null;
    }
    if (typeof secureRaw === 'boolean') {
      return secureRaw;
    }
    return String(secureRaw).toLowerCase() === 'true';
  }
}
