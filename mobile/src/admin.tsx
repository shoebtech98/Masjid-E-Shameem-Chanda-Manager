import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AdminUser,
  AuditEntry,
  AuditStats,
  apiDelete,
  apiGet,
  apiSend,
  User,
} from './api';
import {
  Button,
  Card,
  ChoiceRow,
  Field,
  GridBackdrop,
  Heading,
  LoadingState,
  Notice,
  Screen,
  SectionTitle,
  usePalette,
} from './ui';

type AdminSection = 'users' | 'audit';
type UserRole = AdminUser['role'];
type AuditEntity = 'all' | AuditEntry['entity'];
type AuditAction = 'all' | AuditEntry['action'];

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function timestampLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function AdminScreen({ user }: { user: User }) {
  const colors = usePalette();
  const [section, setSection] = useState<AdminSection>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [auditItems, setAuditItems] = useState<AuditEntry[]>([]);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditStats, setAuditStats] = useState<AuditStats | null>(null);
  const [auditSearch, setAuditSearch] = useState('');
  const [entity, setEntity] = useState<AuditEntity>('all');
  const [action, setAction] = useState<AuditAction>('all');
  const [auditTotal, setAuditTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [editorError, setEditorError] = useState('');
  const [editor, setEditor] = useState<'create' | 'reset' | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('treasurer');
  const usersRequestId = useRef(0);
  const auditRequestId = useRef(0);

  const loadUsers = useCallback(async () => {
    const requestId = ++usersRequestId.current;
    setUsersLoaded(false);
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (userSearch.trim()) params.set('search', userSearch.trim());
      const query = params.toString();
      const result = await apiGet<{ users: AdminUser[] }>(`/api/users${query ? `?${query}` : ''}`);
      if (requestId === usersRequestId.current) {
        setUsers(result.users);
        setUsersLoaded(true);
      }
    } catch (cause) {
      if (requestId === usersRequestId.current) setError(messageOf(cause));
    } finally {
      if (requestId === usersRequestId.current) setBusy(false);
    }
  }, [userSearch]);

  const loadAudit = useCallback(async () => {
    const requestId = ++auditRequestId.current;
    setAuditLoaded(false);
    setBusy(true);
    setError('');
    setAuditItems([]);
    try {
      const params = new URLSearchParams({ limit: '50', offset: '0' });
      if (entity !== 'all') params.set('entity', entity);
      if (action !== 'all') params.set('action', action);
      if (auditSearch.trim()) params.set('search', auditSearch.trim());
      const [result, stats] = await Promise.all([
        apiGet<{ total: number; items: AuditEntry[] }>(`/api/audit?${params.toString()}`),
        apiGet<AuditStats>('/api/audit/stats'),
      ]);
      if (requestId === auditRequestId.current) {
        setAuditItems(result.items);
        setAuditTotal(result.total);
        setAuditStats(stats);
        setAuditLoaded(true);
      }
    } catch (cause) {
      if (requestId === auditRequestId.current) setError(messageOf(cause));
    } finally {
      if (requestId === auditRequestId.current) setBusy(false);
    }
  }, [action, auditSearch, entity]);

  useEffect(() => {
    if (section !== 'users') return undefined;
    const timer = setTimeout(() => { void loadUsers(); }, userSearch.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [loadUsers, section, userSearch]);

  useEffect(() => {
    if (section !== 'audit') return undefined;
    const timer = setTimeout(() => { void loadAudit(); }, auditSearch.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [auditSearch, loadAudit, section]);

  const loadMoreAudit = async () => {
    if (busy || auditItems.length >= auditTotal) return;
    const requestId = auditRequestId.current;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        limit: '50',
        offset: String(auditItems.length),
      });
      if (entity !== 'all') params.set('entity', entity);
      if (action !== 'all') params.set('action', action);
      if (auditSearch.trim()) params.set('search', auditSearch.trim());
      const result = await apiGet<{ total: number; items: AuditEntry[] }>(`/api/audit?${params.toString()}`);
      if (requestId === auditRequestId.current) {
        setAuditItems((current) => [...current, ...result.items]);
        setAuditTotal(result.total);
      }
    } catch (cause) {
      if (requestId === auditRequestId.current) setError(messageOf(cause));
    } finally {
      if (requestId === auditRequestId.current) setBusy(false);
    }
  };

  const openCreate = () => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('treasurer');
    setEditingUser(null);
    setEditorError('');
    setEditor('create');
  };

  const openPasswordReset = (target: AdminUser) => {
    setPassword('');
    setEditingUser(target);
    setEditorError('');
    setEditor('reset');
  };

  const saveEditor = async () => {
    setBusy(true);
    setEditorError('');
    try {
      if (editor === 'create') {
        await apiSend('/api/users', 'POST', { name, email, password, role });
        setEditor(null);
        await loadUsers();
      } else if (editor === 'reset' && editingUser) {
        if ([...password].length < 15) {
          setEditorError('Use at least 15 characters for the temporary password.');
          return;
        }
        await apiSend(`/api/users/${editingUser.id}/password`, 'PUT', { new_password: password });
        setEditor(null);
        setEditingUser(null);
        setPassword('');
        setError('Password reset. The user must sign in again on their devices.');
      }
    } catch (cause) {
      setEditorError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const updateUser = async (target: AdminUser, changes: Partial<Pick<AdminUser, 'role' | 'status'>>) => {
    if (busyUserId !== null) return;
    setBusyUserId(target.id);
    setError('');
    try {
      const result = await apiSend<{ user: AdminUser }>(`/api/users/${target.id}`, 'PUT', changes);
      setUsers((current) => current.map((item) => item.id === target.id ? result.user : item));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyUserId(null);
    }
  };

  const deleteUser = async (target: AdminUser) => {
    if (busyUserId !== null) return;
    setBusyUserId(target.id);
    setError('');
    try {
      await apiDelete<{ ok: boolean }>(`/api/users/${target.id}`);
      await loadUsers();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyUserId(null);
    }
  };

  const confirmDelete = (target: AdminUser) => {
    const browserConfirm = (globalThis as typeof globalThis & {
      confirm?: (message: string) => boolean;
    }).confirm;
    if (Platform.OS === 'web' && browserConfirm) {
      if (browserConfirm(`Delete ${target.name}'s account? This cannot be undone.`)) {
        void deleteUser(target);
      }
      return;
    }
    Alert.alert(
      'Delete user?',
      `Delete ${target.name}'s account? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void deleteUser(target); } },
      ],
    );
  };

  const loadMoreDisabled = busy || auditItems.length >= auditTotal;

  return (
    <>
      <Screen>
        <Heading title="Administration" subtitle="Manage access and review the audit trail." />
        {error ? <Notice>{error}</Notice> : null}
        <ChoiceRow
          value={section}
          onChange={setSection}
          options={[
            { value: 'users', label: 'Users' },
            { value: 'audit', label: 'Audit log' },
          ]}
        />
        {section === 'users' ? (
          <>
            <Card>
              <SectionTitle>User accounts</SectionTitle>
              <Field
                label="Search users"
                value={userSearch}
                onChangeText={setUserSearch}
                returnKeyType="search"
                autoCapitalize="none"
              />
              <Button label="Add user" onPress={openCreate} />
            </Card>
            {busy && users.length === 0 ? <LoadingState label="Loading user accounts…" /> : null}
            {usersLoaded && !busy && users.length === 0 ? (
              <Card><Text style={{ color: colors.muted }}>No users match this search.</Text></Card>
            ) : null}
            {users.map((target) => {
              const isSelf = target.id === user.id;
              return (
                <Card key={target.id}>
                  <View style={styles.userHeading}>
                    <View style={styles.userIdentity}>
                      <Text style={[styles.userName, { color: colors.text }]}>{target.name}</Text>
                      <Text selectable style={{ color: colors.muted }}>{target.email}</Text>
                    </View>
                    <Text style={[styles.userStatus, { color: target.status === 'active' ? colors.greenText : colors.muted }]}>
                      {target.status}
                    </Text>
                  </View>
                  <Text style={[styles.label, { color: colors.muted }]}>Role</Text>
                  <ChoiceRow
                    value={target.role}
                    onChange={(nextRole) => {
                      if (!isSelf) void updateUser(target, { role: nextRole });
                    }}
                    options={[
                      { value: 'admin', label: 'Admin' },
                      { value: 'treasurer', label: 'Treasurer' },
                    ]}
                  />
                  <Text style={[styles.label, { color: colors.muted }]}>Access</Text>
                  <ChoiceRow
                    value={target.status}
                    onChange={(nextStatus) => {
                      if (!isSelf) void updateUser(target, { status: nextStatus });
                    }}
                    options={[
                      { value: 'active', label: 'Active' },
                      { value: 'inactive', label: 'Inactive' },
                    ]}
                  />
                  {isSelf ? <Text style={{ color: colors.muted }}>Your own role and access cannot be changed here.</Text> : null}
                  <Button
                    label="Reset password"
                    variant="secondary"
                    onPress={() => openPasswordReset(target)}
                    disabled={busyUserId === target.id}
                  />
                  <Button
                    label="Delete user"
                    variant="danger"
                    onPress={() => confirmDelete(target)}
                    disabled={isSelf || busyUserId === target.id}
                    busy={busyUserId === target.id}
                  />
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Added {timestampLabel(target.created_at)}
                  </Text>
                </Card>
              );
            })}
          </>
        ) : (
          <>
            {auditStats ? (
              <Card>
                <SectionTitle>Audit summary</SectionTitle>
                <Text style={{ color: colors.muted }}>
                  {auditStats.total} total records · {auditStats.by_entity.map((entry) => `${entry.c} ${entry.entity}`).join(' · ')}
                </Text>
              </Card>
            ) : null}
            <Card>
              <Field
                label="Search activity"
                value={auditSearch}
                onChangeText={setAuditSearch}
                returnKeyType="search"
              />
              <Text style={[styles.label, { color: colors.muted }]}>Entity</Text>
              <ChoiceRow
                value={entity}
                onChange={setEntity}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'household', label: 'Households' },
                  { value: 'payment', label: 'Payments' },
                  { value: 'user', label: 'Users' },
                ]}
              />
              <Text style={[styles.label, { color: colors.muted }]}>Action</Text>
              <ChoiceRow
                value={action}
                onChange={setAction}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'create', label: 'Create' },
                  { value: 'update', label: 'Update' },
                  { value: 'delete', label: 'Delete' },
                  { value: 'reset', label: 'Reset' },
                  { value: 'seed', label: 'Seed' },
                ]}
              />
            </Card>
            {busy && auditItems.length === 0 ? <LoadingState label="Loading audit records…" /> : null}
            {auditLoaded && !busy && auditItems.length === 0 ? (
              <Card><Text style={{ color: colors.muted }}>No audit records match these filters.</Text></Card>
            ) : null}
            {auditItems.map((entry) => (
              <View key={entry.id} style={[styles.auditRow, { borderBottomColor: colors.border }]}>
                <View style={styles.auditHead}>
                  <Text style={[styles.auditAction, { color: colors.text }]}>
                    {entry.action.toUpperCase()} · {entry.entity.toUpperCase()}
                  </Text>
                  <Text style={[styles.auditDate, { color: colors.muted }]}>{timestampLabel(entry.created_at)}</Text>
                </View>
                <Text style={{ color: colors.text }}>{entry.description}</Text>
                <Text style={{ color: colors.muted }}>By {entry.user_name || 'Unknown user'}</Text>
              </View>
            ))}
            {auditItems.length < auditTotal ? (
              <Button
                label="Load older activity"
                variant="secondary"
                onPress={() => { void loadMoreAudit(); }}
                busy={busy}
                disabled={loadMoreDisabled}
              />
            ) : null}
          </>
        )}
      </Screen>

      <Modal
        visible={editor !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!busy) setEditor(null);
        }}
      >
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <GridBackdrop />
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Heading
              title={editor === 'create' ? 'Add user account' : `Reset ${editingUser?.name || 'user'} password`}
              subtitle={editor === 'create' ? 'Create access for an Admin or Treasurer.' : 'The user will need to sign in again.'}
            />
            {editorError ? <Notice>{editorError}</Notice> : null}
            <Card>
              {editor === 'create' ? (
                <>
                  <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
                  <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
                  <Field label="Initial password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
                  <Text style={[styles.label, { color: colors.muted }]}>Role</Text>
                  <ChoiceRow
                    value={role}
                    onChange={setRole}
                    options={[
                      { value: 'admin', label: 'Admin' },
                      { value: 'treasurer', label: 'Treasurer' },
                    ]}
                  />
                </>
              ) : (
                <Field label="Temporary password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
              )}
              <Button
                label={editor === 'create' ? 'Create account' : 'Reset password'}
                onPress={() => { void saveEditor(); }}
                busy={busy}
                disabled={editor === 'create'
                  ? !name.trim() || !email.trim() || [...password].length < 15
                  : [...password].length < 15}
              />
              <Button label="Cancel" variant="plain" onPress={() => setEditor(null)} disabled={busy} />
            </Card>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  userHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  userIdentity: { flex: 1, minWidth: 0, gap: 4 },
  userName: { fontSize: 16, fontWeight: '600' },
  userStatus: { fontSize: 12, textTransform: 'uppercase' },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  auditRow: { gap: 6, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  auditHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  auditAction: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  auditDate: { fontSize: 11, textAlign: 'right' },
  modal: { flex: 1 },
  modalContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 28, gap: 16 },
});
