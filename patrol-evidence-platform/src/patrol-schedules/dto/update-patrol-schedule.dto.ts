import { PartialType } from '@nestjs/mapped-types';
import { CreatePatrolScheduleDto } from './create-patrol-schedule.dto';

export class UpdatePatrolScheduleDto extends PartialType(CreatePatrolScheduleDto) {}
