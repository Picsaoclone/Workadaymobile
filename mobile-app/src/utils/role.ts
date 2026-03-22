export function permissionRoleLabel(role?: string | null): string {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'admin') return 'Admin';
  if (r === 'manager') return 'Manager';
  if (r === 'employee') return 'Employee';
  if (!r) return '';
  return r.charAt(0).toUpperCase() + r.slice(1);
}
