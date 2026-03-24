import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { SitesService } from './sites.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { Site } from './entities/site.entity';

@Controller('sites')
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Post()
  create(@Body() dto: CreateSiteDto): Promise<Site> {
    return this.sitesService.create(dto);
  }

  @Get()
  findAll(): Promise<Site[]> {
    return this.sitesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Site> {
    return this.sitesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSiteDto): Promise<Site> {
    return this.sitesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.sitesService.remove(id);
  }
}
