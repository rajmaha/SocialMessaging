import { getAuthToken } from './auth';
import { API_URL } from '@/lib/config';

/**
 * Fetches the effective permission matrix and stores in localStorage.
 * Returns: { "module_key": ["action1", "action2"], ... }
 */
export async function fetchMyPermissions(): Promise<Record<string, string[]>> {
    const token = getAuthToken();
    if (!token) return {};

    try {
        const response = await fetch(`${API_URL}/roles/my-permissions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return {};
        const data = await response.json();
        const permissions: Record<string, string[]> = data.permissions || {};
        localStorage.setItem('user_permissions', JSON.stringify(permissions));
        return permissions;
    } catch (err) {
        console.error('Failed to fetch user permissions:', err);
        return {};
    }
}

/**
 * Check if user has a specific action on a module.
 */
export function hasPermission(moduleKey: string, action: string): boolean {
    try {
        const user = localStorage.getItem('user');
        if (!user) return false;
        const parsed = JSON.parse(user);
        if (parsed.role === 'admin') return true;

        const stored = localStorage.getItem('user_permissions');
        if (!stored) return false;
        const permissions: Record<string, string[]> = JSON.parse(stored);
        return (permissions[moduleKey] || []).includes(action);
    } catch {
        return false;
    }
}

/**
 * Check if user can view a module (shorthand for hasPermission(key, "view")).
 */
export function hasModuleAccess(moduleKey: string): boolean {
    return hasPermission(moduleKey, 'view');
}

/**
 * LEGACY COMPAT — wraps hasModuleAccess for old page-key checks.
 */
export function hasPageAccess(pageKey: string): boolean {
    return hasModuleAccess(pageKey);
}

/**
 * LEGACY COMPAT — wraps hasModuleAccess for old admin feature checks.
 */
export function hasAdminFeature(featureKey: string): boolean {
    return hasModuleAccess(featureKey);
}

/**
 * LEGACY COMPAT — wraps hasModuleAccess for old channel checks.
 */
export function hasChannelAccess(channelKey: string): boolean {
    return hasModuleAccess(channelKey);
}

/**
 * Check if user has any administrative permissions.
 */
export function hasAnyAdminPermission(): boolean {
    try {
        const stored = localStorage.getItem('user_permissions');
        if (!stored) return false;
        const permissions: Record<string, string[]> = JSON.parse(stored);
        return Object.keys(permissions).length > 0;
    } catch {
        return false;
    }
}

/**
 * LEGACY COMPAT — no longer needed, permissions fetched via fetchMyPermissions.
 */
export function storeUserPages(_pages: string[]): void {
    // No-op. Permissions now stored as matrix via fetchMyPermissions.
}

export async function fetchAndStoreUserPages(): Promise<string[]> {
    const perms = await fetchMyPermissions();
    return Object.keys(perms);
}
