import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PatrolAlertsService } from './patrol-alerts.service';
import { PatrolAlert } from './entities/patrol-alert.entity';
import { SitesService } from '@/sites/sites.service';
import { UserRole } from '@/common/enums/user-role.enum';
import { PatrolAlertType } from '@/common/enums/patrol-alert-type.enum';

describe('PatrolAlertsService', () => {
  let service: PatrolAlertsService;
  let alertsRepo: jest.Mocked<Pick<Repository<PatrolAlert>, 'findOne' | 'save' | 'create' | 'createQueryBuilder'>>;
  let sitesService: jest.Mocked<Pick<SitesService, 'findActiveById' | 'assertCompanyAccess'>>;

  beforeEach(() => {
    alertsRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    alertsRepo.create.mockImplementation((value?: unknown) => value as PatrolAlert);

    sitesService = {
      findActiveById: jest.fn(),
      assertCompanyAccess: jest.fn(),
    };

    service = new PatrolAlertsService(
      alertsRepo as unknown as Repository<PatrolAlert>,
      sitesService as unknown as SitesService,
    );
  });

  it('creates a guard welfare alert for an in-company site', async () => {
    sitesService.findActiveById.mockResolvedValue({
      id: 'site-1',
      companyId: 'company-1',
    } as never);

    alertsRepo.save.mockImplementation(async (value) => ({
      id: 'alert-1',
      ...value,
    }) as PatrolAlert);

    const result = await service.createGuardAlert(
      {
        siteId: 'site-1',
        alertType: PatrolAlertType.WELFARE,
        alertMessage: 'Guard requests welfare check',
      },
      {
        sub: 'guard-1',
        email: 'guard@patrol.local',
        role: UserRole.GUARD,
        companyId: 'company-1',
      },
    );

    expect(result.alertType).toBe(PatrolAlertType.WELFARE);
    expect(result.guardId).toBe('guard-1');
    expect(sitesService.findActiveById).toHaveBeenCalledWith('site-1', expect.objectContaining({ role: UserRole.GUARD }));
  });

  it('blocks non-guards from creating guard alerts', async () => {
    await expect(
      service.createGuardAlert(
        {
          siteId: 'site-1',
          alertType: PatrolAlertType.EMERGENCY,
          alertMessage: 'Emergency trigger',
        },
        {
          sub: 'admin-1',
          email: 'admin@patrol.local',
          role: UserRole.COMPANY_ADMIN,
          companyId: 'company-1',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
