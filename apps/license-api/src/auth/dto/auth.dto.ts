import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  refreshToken?: string;
}

export class MfaChallengeDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  challengeToken!: string;
}

export class MfaEnrollmentConfirmDto extends MfaChallengeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class MfaLoginVerifyDto extends MfaChallengeDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:[A-Z2-7]{4}-){3}[A-Z2-7]{4}$/i)
  recoveryCode?: string;
}
