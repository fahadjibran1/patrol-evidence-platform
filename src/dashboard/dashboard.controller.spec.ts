import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { UserRole } from '@/common/enums/user-role.enum';

describe('DashboardController', () => {
  const user = {
    id: 'user-1',
    role: UserRole.ADMIN,
    companyId: null,
  };

  const overview = {
    date: '2026-03-31',
    siteTotals: { active: 2, withScheduledSlots: 1 },
    slotTotals: { total: 24, Safe: 10, Missing: 10, Pending: 4 },
    imageTotals: { received: 1501 },
    alerts: { unresolved: 0 },
    recentImages: [],
  };

  it('returns overview payload when high-volume sites are active', async () => {
    const dashboardService = {
      getOverview: jest.fn().mockResolvedValue(overview),
    } as unknown as DashboardService;

    const controller = new DashboardController(dashboardService);
    const result = await controller.overview(user as never, '2026-03-31');

    expect(result.siteTotals.active).toBe(2);
    expect(result.imageTotals.received).toBeGreaterThan(0);
    expect(dashboardService.getOverview).toHaveBeenCalledWith(user, '2026-03-31');
  });
});
