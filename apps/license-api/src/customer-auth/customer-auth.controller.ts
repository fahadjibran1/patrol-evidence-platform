import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CustomerPermission } from '@/customer-org/customer-permissions';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerJwtAuthGuard } from './guards/customer-jwt-auth.guard';
import { CustomerPermissionsGuard } from './guards/customer-permissions.guard';
import { CurrentCustomer } from './decorators/current-customer.decorator';
import { RequireCustomerPermissions } from './decorators/require-customer-permissions.decorator';
import {
  CustomerAcceptInvitationDto,
  CustomerChangePasswordDto,
  CustomerForgotPasswordDto,
  CustomerLoginDto,
  CustomerLogoutDto,
  CustomerRefreshDto,
  CustomerResetPasswordDto,
  CustomerVerifyEmailDto,
} from './dto/customer-auth.dto';
import { AuthenticatedCustomer } from './interfaces/authenticated-customer.interface';

@ApiTags('customer-auth')
@Controller('customer/auth')
export class CustomerAuthController {
  constructor(private readonly customerAuthService: CustomerAuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  login(@Body() dto: CustomerLoginDto, @Req() req: Request) {
    return this.customerAuthService.login(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: CustomerRefreshDto) {
    return this.customerAuthService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  async logout(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: CustomerLogoutDto,
    @Req() req: Request,
  ) {
    await this.customerAuthService.logout(customer.sub, dto.refreshToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { success: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  me(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.customerAuthService.me(customer.sub);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  forgotPassword(@Body() dto: CustomerForgotPasswordDto, @Req() req: Request) {
    return this.customerAuthService.requestPasswordReset(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resetPassword(@Body() dto: CustomerResetPasswordDto, @Req() req: Request) {
    return this.customerAuthService.resetPassword(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('change-password')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard, CustomerPermissionsGuard)
  @RequireCustomerPermissions(CustomerPermission.MANAGE_OWN_PROFILE)
  changePassword(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: CustomerChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.customerAuthService.changePassword(customer, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('verify-email')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  verifyEmail(@Body() dto: CustomerVerifyEmailDto, @Req() req: Request) {
    return this.customerAuthService.verifyEmail(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('resend-verification')
  @ApiBearerAuth()
  @UseGuards(CustomerJwtAuthGuard)
  resendVerification(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.customerAuthService.issueEmailVerification(customer.sub);
  }

  @Post('accept-invitation')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  acceptInvitation(@Body() dto: CustomerAcceptInvitationDto, @Req() req: Request) {
    return this.customerAuthService.acceptInvitation(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
