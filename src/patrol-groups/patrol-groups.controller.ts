import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PatrolGroupsService } from './patrol-groups.service';
import { CreatePatrolGroupDto } from './dto/create-patrol-group.dto';
import { UpdatePatrolGroupDto } from './dto/update-patrol-group.dto';
import { PatrolGroup } from './entities/patrol-group.entity';

@Controller('patrol-groups')
export class PatrolGroupsController {
  constructor(private readonly groupsService: PatrolGroupsService) {}

  @Post()
  create(@Body() dto: CreatePatrolGroupDto): Promise<PatrolGroup> {
    return this.groupsService.create(dto);
  }

  @Get()
  findAll(): Promise<PatrolGroup[]> {
    return this.groupsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<PatrolGroup> {
    return this.groupsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePatrolGroupDto): Promise<PatrolGroup> {
    return this.groupsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.groupsService.remove(id);
  }
}
