import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Site } from './entities/site.entity';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';
import { Company } from '@/companies/entities/company.entity';

@Injectable()
export class SitesService {
  constructor(
    @InjectRepository(Site)
    private readonly sitesRepo: Repository<Site>,
    @InjectRepository(Company)
    private readonly companiesRepo: Repository<Company>,
  ) {}

  async create(dto: CreateSiteDto, user: AuthenticatedUser): Promise<Site> {
    const companyId = await this.resolveTargetCompanyId(user, dto.companyId);

    try {
      return await this.sitesRepo.save(
        this.sitesRepo.create({
          ...dto,
          companyId,
          siteCode: dto.siteCode.trim().toUpperCase(),
          siteName: dto.siteName.trim(),
          clientName: dto.clientName?.trim() || undefined,
        }),
      );
    } catch (error) {
      this.rethrowKnownPersistenceError(error, dto.siteCode);
      throw error;
    }
  }

  async findAll(user: AuthenticatedUser): Promise<Site[]> {
    if (this.isPlatformAdmin(user)) {
      return this.sitesRepo.find({
        relations: ['company'],
        order: { siteCode: 'ASC' },
      });
    }

    return this.sitesRepo.find({
      where: { companyId: user.companyId ?? undefined },
      relations: ['company'],
      order: { siteCode: 'ASC' },
    });
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<Site> {
    const site = await this.sitesRepo.findOne({
      where: { id },
      relations: ['company'],
    });

    if (!site) {
      throw new NotFoundException(`Site ${id} not found`);
    }

    this.assertCompanyAccess(user, site.companyId);
    return site;
  }

  async findActiveById(id: string, user: AuthenticatedUser): Promise<Site> {
    const site = await this.findOne(id, user);
    if (!site.active) {
      throw new NotFoundException(`Active site ${id} not found`);
    }
    return site;
  }

  async findActiveByCode(siteCode: string, user: AuthenticatedUser): Promise<Site> {
    const normalizedSiteCode = siteCode.trim().toUpperCase();
    const site = await this.sitesRepo.findOne({
      where: this.isPlatformAdmin(user)
        ? { siteCode: normalizedSiteCode, active: true }
        : { siteCode: normalizedSiteCode, active: true, companyId: user.companyId ?? undefined },
      relations: ['company'],
    });

    if (!site) {
      throw new NotFoundException(`Active site with code ${normalizedSiteCode} not found`);
    }

    return site;
  }

  async update(id: string, dto: UpdateSiteDto, user: AuthenticatedUser): Promise<Site> {
    const site = await this.findOne(id, user);
    const companyId = dto.companyId ? await this.resolveTargetCompanyId(user, dto.companyId) : site.companyId;

    try {
      return await this.sitesRepo.save({
        ...site,
        ...dto,
        companyId,
        siteCode: dto.siteCode ? dto.siteCode.trim().toUpperCase() : site.siteCode,
        siteName: dto.siteName ? dto.siteName.trim() : site.siteName,
        clientName: dto.clientName !== undefined ? dto.clientName.trim() || undefined : site.clientName,
      });
    } catch (error) {
      this.rethrowKnownPersistenceError(error, dto.siteCode ?? site.siteCode);
      throw error;
    }
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const site = await this.findOne(id, user);
    await this.sitesRepo.remove(site);
  }

  assertCompanyAccess(user: AuthenticatedUser, companyId: string): void {
    if (this.isPlatformAdmin(user)) {
      return;
    }

    if (!user.companyId || user.companyId !== companyId) {
      throw new ForbiddenException('You do not have access to this company resource');
    }
  }

  private async resolveTargetCompanyId(user: AuthenticatedUser, requestedCompanyId?: string): Promise<string> {
    if (!this.isPlatformAdmin(user)) {
      if (!user.companyId) {
        throw new ForbiddenException('User is not assigned to a company');
      }

      if (requestedCompanyId && requestedCompanyId !== user.companyId) {
        throw new ForbiddenException('You do not have access to this company resource');
      }

      return user.companyId;
    }

    const companyId = requestedCompanyId?.trim();
    if (!companyId) {
      throw new ForbiddenException('companyId is required for admin site creation');
    }

    const company = await this.companiesRepo.findOne({
      where: { id: companyId, active: true },
    });

    if (!company) {
      throw new NotFoundException(`Active company ${companyId} not found`);
    }

    return company.id;
  }

  private isPlatformAdmin(user: AuthenticatedUser): boolean {
    return user.role === UserRole.ADMIN;
  }

  private rethrowKnownPersistenceError(error: unknown, siteCode: string): void {
    if (
      error instanceof QueryFailedError &&
      typeof (error as { driverError?: { code?: string } }).driverError?.code === 'string' &&
      (error as { driverError?: { code?: string } }).driverError?.code === '23505'
    ) {
      throw new ConflictException(`Site code ${siteCode.trim().toUpperCase()} already exists`);
    }
  }
}
