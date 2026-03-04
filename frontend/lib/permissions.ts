import { getAuthToken } from './auth';
import { API_URL } from '@/lib/config';

/**
 * Fetches all of the user's granted permissions and stores them in localStorage.
 * Returns the array of granted permission keys.
 */
export async function fetchMyPermissions(): Promise<string[]> {
    const token = getAuthToken();
    if (!token) return [];

    try {
        const response = await fetch(`${API_URL}/admin/my-permissions`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) return [];

        const data = await response.json();
        const permissions = data.permissions || [];

        // Store in localStorage for synchronous checks elsewhere
        localStorage.setItem('user_permissions', JSON.stringify(permissions));
        return permissions;
    } catch (err) {
        console.error('Failed to fetch user permissions:', err);
        return [];
    }
}

/**
 * Internal helper to synchronously check if a permission key exists in localStorage.
 */
function hasPermission(permissionKey: string): boolean {
    try {
        const stored = localStorage.getItem('user_permissions');
        if (!stored) return false;
        const permissions = JSON.parse(stored);
        return permissions.includes(permissionKey);
    } catch {
        return false;
    }
}

/**
 * Check if the user has access to a specific module (e.g., module_email)
 */
export function hasModuleAccess(moduleKey: string): boolean {
    return hasPermission(`module_${moduleKey}`);
}

/**
 * Check if the user has access to a specific channel (e.g., channel_whatsapp)
 */
export function hasChannelAccess(channelKey: string): boolean {
    return hasPermission(`channel_${channelKey}`);
}

/**
 * Check if the user has a specific admin feature grant (e.g., feature_manage_users)
 */
export function hasAdminFeature(featureKey: string): boolean {
    return hasPermission(`feature_${featureKey}`);
}

/**
 * Check if the user has ANY administrative or module permission
 */
export function hasAnyAdminPermission(): boolean {
    try {
        const stored = localStorage.getItem('user_permissions');
        if (!stored) return false;
        const permissions = JSON.parse(stored);
        return permissions.some((p: string) => p.startsWith('module_') || p.startsWith('feature_'));
    } catch {
        return false;
    }
}

// ─── Page-level role access (RBAC system) ─────────────────────────────────────

/**
 * Store the current user's page keys after login.
 * Call this once after login or role change.
 */
export function storeUserPages(pages: string[]): void {
  localStorage.setItem('user_pages', JSON.stringify(pages))
}

/**
 * Check if the current user's role grants access to a page key.
 * Admins always return true.
 */
export function hasPageAccess(pageKey: string): boolean {
  try {
    const user = localStorage.getItem('user')
    if (!user) return false
    const parsed = JSON.parse(user)
    if (parsed.role === 'admin') return true
    const stored = localStorage.getItem('user_pages')
    if (!stored) return false
    const pages: string[] = JSON.parse(stored)
    return pages.includes(pageKey)
  } catch {
    return false
  }
}

/**
 * Load the user's page keys from the roles list and cache them.
 * Call after login. Returns the pages array.
 */
export async function fetchAndStoreUserPages(): Promise<string[]> {
  try {
    const user = localStorage.getItem('user')
    if (!user) return []
    const parsed = JSON.parse(user)
    if (parsed.role === 'admin') {
      const allPages = ['pms', 'tickets', 'crm', 'messaging', 'callcenter', 'campaigns', 'reports', 'kb', 'teams']
      storeUserPages(allPages)
      return allPages
    }
    const { rolesApi } = await import('./api')
    const res = await rolesApi.list()
    const roles: any[] = res.data
    const myRole = roles.find((r: any) => r.slug === parsed.role)
    const pages: string[] = myRole?.pages ?? []
    storeUserPages(pages)
    return pages
  } catch {
    return []
  }
}
