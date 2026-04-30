import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { colors } from '../theme/colors';
import { companyApi, userApi } from '../services/api';
import { AuthUser, JobRole, JobRoleColorToken, UserRole } from '../types/models';
import { useAuthStore } from '../store/authStore';
import { hexToRgba } from '../utils/color';
import { permissionRoleLabel } from '../utils/role';

const PERMISSION_ROLE_OPTIONS: Array<Exclude<UserRole, 'admin'>> = ['employee', 'manager'];
const JOB_ROLE_COLOR_OPTIONS: JobRoleColorToken[] = ['primary', 'info', 'success', 'warning', 'danger', 'purple', 'teal'];

function roleBaseColor(role: UserRole): string {
  switch (role) {
    case 'admin':
      return colors.danger;
    case 'manager':
      return colors.info;
    case 'employee':
    default:
      return colors.success;
  }
}

function colorFromToken(token: JobRoleColorToken | string | undefined | null): string {
  const t = String(token || '').trim() as keyof typeof colors;
  return (colors as any)[t] || colors.primary;
}

export function EmployeesScreen() {
  const me = useAuthStore((s) => s.user);
  const setMe = useAuthStore((s) => s.setUser);

  const [refreshing, setRefreshing] = useState(false);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRole[]>([]);
  const [roleSubmitting, setRoleSubmitting] = useState<{ userId: string; role: UserRole } | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const [expandedJobRoleUserId, setExpandedJobRoleUserId] = useState<string | null>(null);
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColorToken, setNewRoleColorToken] = useState<JobRoleColorToken>('primary');
  const [creatingRole, setCreatingRole] = useState(false);

  const loadUsers = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await userApi.getAll();
      const list = response.data.data || [];
      setUsers(list);

      if (me) {
        const serverMe = list.find((u) => u._id === me._id);
        if (serverMe) {
          const shouldUpdate =
            serverMe.role !== me.role ||
            serverMe.companyId !== me.companyId ||
            serverMe.name !== me.name ||
            serverMe.email !== me.email ||
            serverMe.isActive !== me.isActive;

          if (shouldUpdate) {
            setMe({ ...me, ...serverMe });
          }
        }
      }
    } finally {
      setRefreshing(false);
    }
  }, [me, setMe]);

  const loadJobRoles = useCallback(async () => {
    try {
      const response = await companyApi.getJobRoles();
      setJobRoles(response.data.data || []);
    } catch {
      setJobRoles([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadUsers();
      loadJobRoles();
    }, [loadJobRoles, loadUsers])
  );

  const visibleUsers = useMemo(() => users.filter((u) => u.isActive), [users]);

  const setRole = useCallback(
    async (target: AuthUser, nextRole: UserRole) => {
      if (!me || me.role !== 'admin') return;
      if (target._id === me._id) {
        Alert.alert('Không thể đổi role', 'Admin không thể đổi role cho chính mình.');
        return;
      }
      if (nextRole === 'admin') {
        Alert.alert('Không thể gán quyền admin', 'Không thể gán quyền admin cho người khác.');
        return;
      }
      if (target.role === nextRole) return;

      try {
        setRoleSubmitting({ userId: target._id, role: nextRole });
        const response = await userApi.updateProfile(target._id, { role: nextRole });
        const updated = response.data.data || { ...target, role: nextRole };
        setUsers((current) => current.map((item) => (item._id === updated._id ? { ...item, ...updated } : item)));
      } catch {
        Alert.alert('Không thể cập nhật role', 'Vui lòng thử lại.');
      } finally {
        setRoleSubmitting(null);
      }
    },
    [me]
  );

  const setJobRole = useCallback(
    async (target: AuthUser, nextJobRoleKey: string | null) => {
      if (!me || me.role !== 'admin') return;
      if (target._id === me._id) {
        Alert.alert('Không thể đổi role', 'Admin không thể tự chỉnh role của bản thân ở đây.');
        return;
      }
      if (target.role !== 'employee') {
        Alert.alert('Không thể gán vai trò công việc', 'Chỉ Employee mới cần/được gán vai trò công việc.');
        return;
      }

      try {
        setRoleSubmitting({ userId: target._id, role: target.role });
        const response = await userApi.updateProfile(target._id, { jobRoleKey: nextJobRoleKey } as any);
        const updated = response.data.data || { ...target, jobRoleKey: nextJobRoleKey };
        setUsers((current) => current.map((item) => (item._id === updated._id ? { ...item, ...updated } : item)));
      } catch {
        Alert.alert('Không thể cập nhật role', 'Vui lòng thử lại.');
      } finally {
        setRoleSubmitting(null);
      }
    },
    [me]
  );

  const createJobRole = useCallback(async () => {
    if (!me || me.role !== 'admin') return;

    const name = newRoleName.trim();
    if (!name) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tên role.');
      return;
    }

    try {
      setCreatingRole(true);
      await companyApi.createJobRole({ name, colorToken: newRoleColorToken });
      setNewRoleName('');
      setNewRoleColorToken('primary');
      setAddingRole(false);
      await loadJobRoles();
    } catch {
      Alert.alert('Không thể tạo role', 'Vui lòng thử lại.');
    } finally {
      setCreatingRole(false);
    }
  }, [loadJobRoles, me, newRoleColorToken, newRoleName]);

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadUsers} tintColor={colors.primary} />}
    >
      <View style={styles.pageTitleRow}>
        <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
          <Ionicons name="people-outline" size={18} color={colors.primaryDark} />
        </View>
        <Text style={styles.pageTitle}>Nhân sự</Text>
      </View>

      {me?.role === 'admin' ? (
        <Card style={{ backgroundColor: colors.secondary }}>
          <View style={styles.addRoleHeader}>
            <Text style={styles.addRoleTitle}>Vai trò công việc</Text>
            <AppButton
              label={addingRole ? 'Đóng' : 'Thêm role'}
              variant="outline"
              onPress={() => setAddingRole((v) => !v)}
              style={styles.addRoleButton}
            />
          </View>

          {addingRole ? (
            <View style={styles.addRoleBody}>
              <AppInput
                label="Tên role"
                value={newRoleName}
                onChangeText={setNewRoleName}
                placeholder="VD: Kế toán, HR, Dev..."
              />

              <View style={styles.colorRow}>
                <Text style={styles.colorLabel}>Màu</Text>
                <View style={styles.colorOptions}>
                  {JOB_ROLE_COLOR_OPTIONS.map((token) => {
                    const c = colorFromToken(token);
                    const active = newRoleColorToken === token;
                    return (
                      <TouchableOpacity
                        key={token}
                        onPress={() => setNewRoleColorToken(token)}
                        style={[
                          styles.colorDot,
                          { backgroundColor: c, borderColor: active ? colors.border : hexToRgba(colors.border, 0.5) },
                        ]}
                      />
                    );
                  })}
                </View>
              </View>

              <AppButton label="Tạo role" onPress={createJobRole} loading={creatingRole} />
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.secondary }}>
        {visibleUsers.length === 0 ? (
          <Text style={styles.emptyText}>Chưa có thành viên trong công ty.</Text>
        ) : (
          visibleUsers.map((member) => {
            const isUpdating = roleSubmitting?.userId === member._id;
            const canEdit = me?.role === 'admin' && member._id !== me?._id;
            const isExpanded = expandedUserId === member._id;
            const memberRoleColor = roleBaseColor(member.role);
            const isJobExpanded = expandedJobRoleUserId === member._id;

            const canShowJobRole = member.role === 'employee';

            const jobRole = member.jobRoleKey ? jobRoles.find((r) => r.key === member.jobRoleKey) : undefined;
            const jobRoleLabel = jobRole?.name || 'Chưa gán';
            const jobRoleColor = jobRole ? colorFromToken(jobRole.colorToken) : colors.muted;

            return (
              <View key={member._id} style={[styles.row, isExpanded ? styles.rowExpanded : undefined]}>
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>
                      {member.name}
                      {member._id === me?._id ? <Text style={styles.meTag}> (Bạn)</Text> : null}
                    </Text>
                    <Text style={styles.meta}>{member.email}</Text>
                  </View>

                  {me?.role === 'admin' ? (
                    isUpdating ? (
                      <View style={styles.loadingSlot}>
                        <ActivityIndicator color={colors.primary} />
                      </View>
                    ) : (
                      <View style={styles.roleWrap}>
                        <TouchableOpacity
                          disabled={!canEdit}
                          onPress={() => setExpandedUserId((cur) => (cur === member._id ? null : member._id))}
                          style={[
                            styles.rolePill,
                            {
                              backgroundColor: hexToRgba(memberRoleColor, 0.18),
                              borderColor: hexToRgba(memberRoleColor, 0.62),
                            },
                            !canEdit ? styles.rolePillDisabled : undefined,
                          ]}
                        >
                          <Text style={styles.rolePillText}>{permissionRoleLabel(member.role)}</Text>
                          <Text style={styles.roleChevron}>{isExpanded ? '▴' : '▾'}</Text>
                        </TouchableOpacity>

                        {canShowJobRole ? (
                          <TouchableOpacity
                            disabled={!canEdit}
                            onPress={() => setExpandedJobRoleUserId((cur) => (cur === member._id ? null : member._id))}
                            style={[
                              styles.rolePill,
                              {
                                backgroundColor: hexToRgba(jobRoleColor, jobRole ? 0.18 : 0.08),
                                borderColor: hexToRgba(jobRoleColor, jobRole ? 0.62 : 0.4),
                              },
                              !canEdit ? styles.rolePillDisabled : undefined,
                            ]}
                          >
                            <Text style={styles.rolePillText}>{jobRoleLabel}</Text>
                            <Text style={styles.roleChevron}>{isJobExpanded ? '▴' : '▾'}</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    )
                  ) : (
                    <View style={styles.roleWrap}>
                      <View
                        style={[
                          styles.rolePill,
                          {
                            backgroundColor: hexToRgba(memberRoleColor, 0.18),
                            borderColor: hexToRgba(memberRoleColor, 0.62),
                          },
                        ]}
                      >
                        <Text style={styles.rolePillText}>{permissionRoleLabel(member.role)}</Text>
                      </View>

                      {canShowJobRole ? (
                        <View
                          style={[
                            styles.rolePill,
                            {
                              backgroundColor: hexToRgba(jobRoleColor, jobRole ? 0.18 : 0.08),
                              borderColor: hexToRgba(jobRoleColor, jobRole ? 0.62 : 0.4),
                            },
                          ]}
                        >
                          <Text style={styles.rolePillText}>{jobRoleLabel}</Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>

                {me?.role === 'admin' && canEdit && isExpanded ? (
                  <View style={styles.dropdown}>
                    {PERMISSION_ROLE_OPTIONS.map((role) => {
                      const active = member.role === role;
                      const c = roleBaseColor(role);
                      return (
                        <TouchableOpacity
                          key={role}
                          onPress={() => {
                            setExpandedUserId(null);
                            setRole(member, role);
                          }}
                          style={[
                            styles.option,
                            {
                              backgroundColor: hexToRgba(c, active ? 0.22 : 0.12),
                              borderColor: hexToRgba(c, 0.62),
                            },
                          ]}
                        >
                          <Text style={styles.optionText}>{permissionRoleLabel(role)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}

                {me?.role === 'admin' && canEdit && canShowJobRole && isJobExpanded ? (
                  <View style={styles.dropdown}>
                    <TouchableOpacity
                      onPress={() => {
                        setExpandedJobRoleUserId(null);
                        setJobRole(member, null);
                      }}
                      style={[
                        styles.option,
                        { backgroundColor: hexToRgba(colors.muted, 0.08), borderColor: hexToRgba(colors.muted, 0.4) },
                      ]}
                    >
                      <Text style={styles.optionText}>Bỏ gán</Text>
                    </TouchableOpacity>

                    {jobRoles.map((jr) => {
                      const active = member.jobRoleKey === jr.key;
                      const c = colorFromToken(jr.colorToken);
                      return (
                        <TouchableOpacity
                          key={jr.key}
                          onPress={() => {
                            setExpandedJobRoleUserId(null);
                            setJobRole(member, jr.key);
                          }}
                          style={[
                            styles.option,
                            {
                              backgroundColor: hexToRgba(c, active ? 0.22 : 0.12),
                              borderColor: hexToRgba(c, 0.62),
                            },
                          ]}
                        >
                          <Text style={styles.optionText}>{jr.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </Card>

      {me?.role === 'admin' ? (
        <Text style={styles.hint}>Lưu ý: admin không thể đổi role cho chính mình.</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pageTitleIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    fontSize: 28,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_600SemiBold',
    marginTop: 6,
  },
  row: {
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: hexToRgba(colors.border, 0.6),
  },
  rowExpanded: {
    paddingBottom: 12,
  },
  rowTop: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  name: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  meTag: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  meta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  roleWrap: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 2,
    backgroundColor: colors.white,
  },
  rolePillDisabled: {
    opacity: 0.55,
  },
  rolePillText: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  roleChevron: {
    color: hexToRgba(colors.primaryDark, 0.6),
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
    marginTop: -1,
  },
  dropdown: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  addRoleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  addRoleTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  addRoleButton: {
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  addRoleBody: {
    marginTop: 10,
    gap: 10,
  },
  colorRow: {
    gap: 8,
  },
  colorLabel: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  colorOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
  },
  option: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 2,
  },
  optionText: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  loadingSlot: {
    width: 64,
    alignItems: 'flex-end',
  },
});
