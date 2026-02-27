import { getAuthToken } from './auth';

/**
 * Fetches all of the user's granted permissions and stores them in localStorage.
 * Returns the array of granted permission keys.
 */
export async function fetchMyPermissions(): Promise<string[]> {
    const token = getAuthToken();
    if (!token) return [];

    try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/my-permissions`, {
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
