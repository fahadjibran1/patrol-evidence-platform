import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsOptional, IsString, Length, MaxLength, Matches } from 'class-validator';

function normalize(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

export class CommercialCheckoutDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  customerEmail!: string;

  @IsOptional()
  @Transform(({ value }) => normalize(value))
  @IsString()
  @Length(1, 120)
  @Matches(/^(?!.*\p{Cc}).+$/u)
  contactName?: string;

  @IsBoolean()
  @Equals(true)
  legalAccepted!: true;

  @IsString()
  @Length(1, 100)
  acceptedTermsVersion!: string;

  @IsString()
  @Length(1, 100)
  acceptedPrivacyVersion!: string;
}
