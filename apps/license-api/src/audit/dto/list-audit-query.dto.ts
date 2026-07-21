import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';

export class ListAuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
