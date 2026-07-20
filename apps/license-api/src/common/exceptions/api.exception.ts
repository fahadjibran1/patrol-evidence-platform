import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '../constants/error-codes';

export class ApiException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}
