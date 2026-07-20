import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiException } from '../exceptions/api.exception';
import { ERROR_CODES } from '../constants/error-codes';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ApiException) {
      const body = exception.getResponse();
      response.status(exception.getStatus()).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : typeof raw === 'object' && raw !== null && 'message' in raw
            ? Array.isArray((raw as { message: unknown }).message)
              ? (raw as { message: string[] }).message.join('; ')
              : String((raw as { message: unknown }).message)
            : exception.message;

      response.status(status).json({
        code: status === HttpStatus.BAD_REQUEST ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_ERROR,
        message,
      });
      return;
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred.',
    });
  }
}
