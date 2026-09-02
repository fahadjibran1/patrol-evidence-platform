import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { LicencesPage } from '../pages/licences-page';
import { AppLayout } from '../components/layout';
import type { AdminRole } from '../types';

vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ items: [], total: 0, page: 1, pageSize: 100 }),
})));

function renderWithRole(role: AdminRole): void {
  sessionStorage.setItem('patrol-license-portal-auth', JSON.stringify({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    admin: {
      id: 'admin-1',
      email: 'admin@patrol.local',
      displayName: 'Portal Admin',
      role,
      isActive: true,
    },
  }));

  render(
    <MemoryRouter initialEntries={['/licences']}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route path="licences" element={<LicencesPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('role visibility', () => {
  it('hides issue actions for SUPPORT users', () => {
    renderWithRole('SUPPORT');
    expect(screen.queryByRole('link', { name: 'Issue licence' })).not.toBeInTheDocument();
  });

  it('shows issue actions for ADMIN users', () => {
    renderWithRole('ADMIN');
    expect(screen.getByRole('link', { name: 'Issue licence' })).toBeInTheDocument();
  });

  it('shows admin navigation only for SUPER_ADMIN', () => {
    renderWithRole('SUPER_ADMIN');
    expect(screen.getByRole('link', { name: 'Admin users' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'System status' })).toBeInTheDocument();
  });

  it('shows System status for ADMIN but not Admin users', () => {
    renderWithRole('ADMIN');
    expect(screen.getByRole('link', { name: 'System status' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin users' })).not.toBeInTheDocument();
  });
});
