import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, LogoutDto, RefreshDto } from './dto/auth.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from './interfaces/authenticated-admin.interface';

@ApiTags('auth')
@Controller('admin/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  logout(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: LogoutDto, @Req() req: Request) {
    return this.authService.logout(admin.sub, dto.refreshToken, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.authService.me(admin.sub);
  }
}
