import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetDesktopAdminPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  newPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(120)
  confirmPassword!: string;

  @IsBoolean()
  confirmed!: boolean;
}
