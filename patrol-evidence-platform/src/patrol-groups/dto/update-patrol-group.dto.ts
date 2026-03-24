import { PartialType } from '@nestjs/mapped-types';
import { CreatePatrolGroupDto } from './create-patrol-group.dto';

export class UpdatePatrolGroupDto extends PartialType(CreatePatrolGroupDto) {}
