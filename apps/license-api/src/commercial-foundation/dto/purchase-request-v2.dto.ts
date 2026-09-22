import { Transform } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  COMMERCIAL_PLAN,
  COMMERCIAL_PRODUCT,
  PURCHASE_REQUEST_SCHEMA_VERSION,
} from '../commercial.constants';

function normalizeCompanyName(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

export class PurchaseRequestV2Dto {
  @IsUUID('4')
  requestId!: string;

  @IsInt()
  @Equals(PURCHASE_REQUEST_SCHEMA_VERSION)
  schemaVersion!: number;

  @IsString()
  @Equals(COMMERCIAL_PRODUCT)
  product!: string;

  @IsString()
  @IsIn([COMMERCIAL_PLAN])
  plan!: typeof COMMERCIAL_PLAN;

  @IsUUID('4')
  installationId!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/i)
  machineFingerprint!: string;

  @Transform(({ value }) => normalizeCompanyName(value))
  @IsString()
  @Length(1, 160)
  @Matches(/^(?!.*\p{Cc}).+$/u)
  companyName!: string;

  @IsString()
  @MaxLength(40)
  @Matches(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  appVersion!: string;

  @IsString()
  @Length(1, 80)
  @Matches(/^[0-9A-Za-z._-]+$/)
  buildId!: string;

  @IsString()
  @Length(32, 128)
  @Matches(/^[0-9A-Za-z_-]+$/)
  clientNonce!: string;

  @IsOptional()
  @IsString()
  @Matches(/^lic-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  previousLicenceId?: string | null;
}

export interface CanonicalPurchaseRequestV2 {
  requestId: string;
  schemaVersion: number;
  product: typeof COMMERCIAL_PRODUCT;
  plan: typeof COMMERCIAL_PLAN;
  installationId: string;
  machineFingerprint: string;
  companyName: string;
  appVersion: string;
  buildId: string;
  clientNonce: string;
  previousLicenceId: string | null;
}
