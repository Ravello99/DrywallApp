// Works out who is signed in. The role comes from the server (/auth/me), not just what was
// saved on the device, so role changes (e.g. the Oakdale "manager" -> "admin" update) take
// effect without signing out. Falls back to the saved user when the server can't be reached.
import { authService, storage } from './authService';
import { isOfficeRole } from '../constants/roles';

export type SessionUser = { id: string; email: string; name: string; role: string; assigned_sites: string[] };

let cached: { user: SessionUser | null; at: number } | null = null;

export async function resolveSession(force = false): Promise<SessionUser | null> {
  if (!force && cached && Date.now() - cached.at < 30_000) return cached.user;
  const token = await authService.getStoredToken();
  if (!token) {
    cached = { user: null, at: Date.now() };
    return null;
  }
  try {
    const fresh = await authService.getCurrentUser();
    await storage.setItem('user', JSON.stringify(fresh));
    cached = { user: fresh, at: Date.now() };
    return fresh;
  } catch (error: any) {
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      await authService.logout();
      cached = { user: null, at: Date.now() };
      return null;
    }
    const stored = await authService.getStoredUser(); // offline: trust what we saved
    cached = { user: stored, at: Date.now() };
    return stored;
  }
}

export function clearSessionCache() {
  cached = null;
}

/** Where a signed-in user belongs. */
export function homeFor(role?: string | null): '/manager' | '/worker' {
  return isOfficeRole(role) ? '/manager' : '/worker';
}
