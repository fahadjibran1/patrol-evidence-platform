import { IsOptional, IsString } from 'class-validator';

export class SendTestImageDto {
  @IsOptional()
  @IsString()
  groupId?: string;
}
