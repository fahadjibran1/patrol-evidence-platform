import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class StartCommercialPurchaseDto {
  @IsUUID('4')
  requestId!: string;

  @IsString()
  @Length(32, 128)
  @Matches(/^[0-9A-Za-z_-]+$/)
  clientNonce!: string;

  @IsOptional()
  @IsString()
  @Matches(/^lic-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  previousLicenceId?: string | null;
}

export class CommercialPurchaseStatusDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  purchaseReference!: string;
}
