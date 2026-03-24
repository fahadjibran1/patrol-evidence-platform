import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolSlot } from './entities/patrol-slot.entity';
import { PatrolSlotsService } from './patrol-slots.service';
import { PatrolSlotsController } from './patrol-slots.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolSlot])],
  providers: [PatrolSlotsService],
  controllers: [PatrolSlotsController],
  exports: [PatrolSlotsService, TypeOrmModule],
})
export class PatrolSlotsModule {}
