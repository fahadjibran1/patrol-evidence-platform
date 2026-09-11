import { IsString, Matches } from 'class-validator';

export class AuthorizeDesktopRecoveryDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43,128}$/)
  token!: string;
}
