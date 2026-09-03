import { readFileSync } from 'fs';
import * as path from 'path';

describe('desktop auth refresh contract', () => {
  it('keeps refresh outside the context value and memoizes its identity', () => {
    const source = readFileSync(path.join(process.cwd(), 'web', 'src', 'state', 'auth.tsx'), 'utf8');
    expect(source).toMatch(/const refresh = useCallback\(/);
    expect(source).toMatch(/\n\s+refresh,\n/);
    expect(source).not.toMatch(/async refresh\(\)\s*\{/);
  });

  it('retains login, logout and the authenticated user refresh operation', () => {
    const source = readFileSync(path.join(process.cwd(), 'web', 'src', 'state', 'auth.tsx'), 'utf8');
    expect(source).toContain("apiRequest<LoginResponse>('/auth/login'");
    expect(source).toContain("'/auth/logout'");
    expect(source).toContain("apiRequest<AuthUser>('/auth/me'");
  });

  it('propagates completed desktop setup to the parent bootstrap state', () => {
    const app = readFileSync(path.join(process.cwd(), 'web', 'src', 'App.tsx'), 'utf8');
    const setup = readFileSync(path.join(process.cwd(), 'web', 'src', 'pages', 'desktop-setup-page.tsx'), 'utf8');
    expect(app).toContain("addEventListener('patrol:desktop-setup-completed'");
    expect(setup).toContain("dispatchEvent(new Event('patrol:desktop-setup-completed'))");
  });
});
