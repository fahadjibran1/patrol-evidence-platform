import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatrolImage } from './entities/patrol-image.entity';
import { CreatePatrolImageDto } from './dto/create-patrol-image.dto';
import { ComplianceService } from '@/compliance/compliance.service';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';

@Injectable()
export class PatrolImagesService {
  constructor(
    @InjectRepository(PatrolImage)
    private readonly imageRepo: Repository<PatrolImage>,
    private readonly complianceService: ComplianceService,
  ) {}

  async create(dto: CreatePatrolImageDto): Promise<PatrolImage> {
    const image = await this.imageRepo.save(
      this.imageRepo.create({
        ...dto,
        sentAt: new Date(dto.sentAt),
        receivedAt: new Date(dto.receivedAt),
        status: PatrolSlotStatus.PENDING,
      }),
    );

    const status = await this.complianceService.updateSlotStatusFromImage(image);

    image.status = status;
    return this.imageRepo.save(image);
  }
}
