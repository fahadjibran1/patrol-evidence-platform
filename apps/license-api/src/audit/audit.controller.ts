import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() pagination: PaginationQueryDto, @Query('customerId') customerId?: string) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.pageSize ?? 20;
    const where = customerId ? { customerId } : {};

    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { email: true, displayName: true } } },
      }),
    ]);

    return paginate(items, total, page, pageSize);
  }
}
