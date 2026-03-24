import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PatrolSchedulesService } from './patrol-schedules.service';
import { CreatePatrolScheduleDto } from './dto/create-patrol-schedule.dto';
import { UpdatePatrolScheduleDto } from './dto/update-patrol-schedule.dto';
import { PatrolSchedule } from './entities/patrol-schedule.entity';

@Controller('patrol-schedules')
export class PatrolSchedulesController {
  constructor(private readonly schedulesService: PatrolSchedulesService) {}

  @Post()
  create(@Body() dto: CreatePatrolScheduleDto): Promise<PatrolSchedule> {
    return this.schedulesService.create(dto);
  }

  @Get()
  findAll(): Promise<PatrolSchedule[]> {
    return this.schedulesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<PatrolSchedule> {
    return this.schedulesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePatrolScheduleDto): Promise<PatrolSchedule> {
    return this.schedulesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.schedulesService.remove(id);
  }
}
