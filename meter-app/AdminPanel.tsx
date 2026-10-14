import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  approveMeterReading,
  createMeterInspector,
  deactivateMeterInspector,
  getAdminCompletedMeterReadings,
  getAdminInspectors,
  getAdminPendingMeterReadings,
  getAdminRejectedMeterReadings,
  rejectMeterReading,
  setMeterInspectorPassword,
  type AdminInspector,
  type MeterReadingSubmission,
} from './api';
import { LANG, type Language } from './translations';

type AdminPanelProps = {
  language: Language;
  onSignOut: () => void | Promise<void>;
};

type PasswordFields = {
  password: string;
  confirmation: string;
};

type AdminSection = 'overview' | 'readings' | 'passwords' | 'create' | 'deactivate';
type ReadingTab = 'Pending' | 'Completed' | 'Rejected';
type NewInspectorFields = {
  readerCode: string;
  name: string;
  phoneNumber: string;
  email: string;
  password: string;
  confirmation: string;
};

export default function AdminPanel({ language, onSignOut }: AdminPanelProps) {
  const t = LANG[language];
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [inspectors, setInspectors] = useState<AdminInspector[]>([]);
  const [passwordFields, setPasswordFields] = useState<Record<string, PasswordFields>>({});
  const [visiblePasswordCodes, setVisiblePasswordCodes] = useState<Record<string, boolean>>({});
  const [inspectorSearch, setInspectorSearch] = useState('');
  const [inspectorSearchQuery, setInspectorSearchQuery] = useState('');
  const [selectedPasswordInspector, setSelectedPasswordInspector] = useState<AdminInspector | null>(null);
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ readerCode: string; message: string } | null>(null);
  const [pendingReadings, setPendingReadings] = useState<MeterReadingSubmission[]>([]);
  const [approvedReadings, setApprovedReadings] = useState<MeterReadingSubmission[]>([]);
  const [rejectedReadings, setRejectedReadings] = useState<MeterReadingSubmission[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState('');
  const [readingTab, setReadingTab] = useState<ReadingTab>('Pending');
  const [selectedReadingIds, setSelectedReadingIds] = useState<string[]>([]);
  const [readingDetails, setReadingDetails] = useState<MeterReadingSubmission | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [approvingReadingId, setApprovingReadingId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState('');
  const [newInspector, setNewInspector] = useState<NewInspectorFields>({
    readerCode: '', name: '', phoneNumber: '', email: '', password: '', confirmation: '',
  });
  const [newInspectorVisible, setNewInspectorVisible] = useState(false);
  const [newInspectorSaving, setNewInspectorSaving] = useState(false);
  const [newInspectorFeedback, setNewInspectorFeedback] = useState<{ message: string; success: boolean } | null>(null);
  const [deactivationSearch, setDeactivationSearch] = useState('');
  const [deactivationQuery, setDeactivationQuery] = useState('');
  const [selectedDeactivationInspector, setSelectedDeactivationInspector] = useState<AdminInspector | null>(null);
  const [deactivationTarget, setDeactivationTarget] = useState<AdminInspector | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivationFeedback, setDeactivationFeedback] = useState<{ message: string; success: boolean } | null>(null);

  const loadReadings = useCallback(async () => {
    setPendingLoading(true);
    setPendingError('');
    try {
      const [pending, approved, rejected] = await Promise.all([
        getAdminPendingMeterReadings(),
        getAdminCompletedMeterReadings(),
        getAdminRejectedMeterReadings(),
      ]);
      setPendingReadings(pending);
      setApprovedReadings(approved);
      setRejectedReadings(rejected);
    } catch (error) {
      setPendingError(error instanceof Error
        ? `${t.adminReadingsLoadFailed} (${error.message})`
        : t.adminReadingsLoadFailed);
    } finally {
      setPendingLoading(false);
    }
  }, [t.adminReadingsLoadFailed]);

  const loadInspectors = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setInspectors(await getAdminInspectors());
    } catch (error) {
      setLoadError(error instanceof Error
        ? `${t.adminInspectorsLoadFailed} (${error.message})`
        : t.adminInspectorsLoadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.adminInspectorsLoadFailed]);

  useEffect(() => {
    void loadInspectors();
  }, [loadInspectors]);

  useEffect(() => {
    void loadReadings();
  }, [loadReadings]);

  const approveReading = async (readingId: string) => {
    setApprovingReadingId(readingId);
    setApprovalError('');
    try {
      await approveMeterReading(readingId);
      await loadReadings();
      setSelectedReadingIds((current) => current.filter((id) => id !== readingId));
      setReadingDetails(null);
    } catch {
      setApprovalError(t.adminReadingApprovalFailed);
    } finally {
      setApprovingReadingId(null);
    }
  };

  const rejectReading = async (readingId: string) => {
    setApprovingReadingId(readingId);
    setApprovalError('');
    try {
      await rejectMeterReading(readingId);
      await loadReadings();
      setSelectedReadingIds((current) => current.filter((id) => id !== readingId));
      setReadingDetails(null);
    } catch {
      setApprovalError(t.adminReadingApprovalFailed);
    } finally {
      setApprovingReadingId(null);
    }
  };

  const updateSelectedReadings = async (action: 'approve' | 'reject') => {
    if (selectedReadingIds.length === 0) return;
    setBulkUpdating(true);
    setApprovalError('');
    const results = await Promise.allSettled(
      selectedReadingIds.map((readingId) =>
        action === 'approve' ? approveMeterReading(readingId) : rejectMeterReading(readingId),
      ),
    );
    await loadReadings();
    setSelectedReadingIds([]);
    if (results.some((result) => result.status === 'rejected')) {
      setApprovalError(t.adminBulkActionFailed);
    }
    setBulkUpdating(false);
  };

  const updatePasswordField = (readerCode: string, field: keyof PasswordFields, value: string) => {
    setPasswordFields((current) => ({
      ...current,
      [readerCode]: {
        password: current[readerCode]?.password ?? '',
        confirmation: current[readerCode]?.confirmation ?? '',
        [field]: value,
      },
    }));
    setFeedback(null);
  };

  const savePassword = async (readerCode: string) => {
    const fields = passwordFields[readerCode] ?? { password: '', confirmation: '' };
    if (fields.password.length < 12) {
      setFeedback({ readerCode, message: t.adminPasswordTooShort });
      return;
    }
    if (fields.password !== fields.confirmation) {
      setFeedback({ readerCode, message: t.adminPasswordMismatch });
      return;
    }

    setSavingCode(readerCode);
    setFeedback(null);
    try {
      await setMeterInspectorPassword(readerCode, fields.password);
      setInspectors((current) =>
        current.map((inspector) =>
          inspector.readerCode === readerCode
            ? { ...inspector, passwordConfigured: true, isActive: true }
            : inspector,
        ),
      );
      setSelectedPasswordInspector((current) =>
        current?.readerCode === readerCode
          ? { ...current, passwordConfigured: true, isActive: true }
          : current,
      );
      setPasswordFields((current) => ({
        ...current,
        [readerCode]: { password: '', confirmation: '' },
      }));
      setPasswordEditorOpen(false);
      setFeedback({ readerCode, message: t.adminPasswordSaved });
    } catch {
      setFeedback({ readerCode, message: t.adminPasswordSaveFailed });
    } finally {
      setSavingCode(null);
    }
  };

  const createInspector = async () => {
    if (!newInspector.readerCode.trim() || !newInspector.name.trim() || !newInspector.phoneNumber.trim() || !newInspector.email.trim()) {
      setNewInspectorFeedback({ message: t.completeAllFields, success: false });
      return;
    }
    if (newInspector.password.length < 12) {
      setNewInspectorFeedback({ message: t.adminPasswordTooShort, success: false });
      return;
    }
    if (newInspector.password !== newInspector.confirmation) {
      setNewInspectorFeedback({ message: t.adminPasswordMismatch, success: false });
      return;
    }
    setNewInspectorSaving(true);
    setNewInspectorFeedback(null);
    try {
      const created = await createMeterInspector({
        readerCode: newInspector.readerCode.trim(),
        name: newInspector.name.trim(),
        phoneNumber: newInspector.phoneNumber.trim(),
        email: newInspector.email.trim(),
        password: newInspector.password,
      });
      setInspectors((current) => [...current.filter((item) => item.readerCode !== created.readerCode), created]);
      setNewInspector({ readerCode: '', name: '', phoneNumber: '', email: '', password: '', confirmation: '' });
      setNewInspectorFeedback({ message: t.adminInspectorCreated, success: true });
    } catch {
      setNewInspectorFeedback({ message: t.adminInspectorCreateFailed, success: false });
    } finally {
      setNewInspectorSaving(false);
    }
  };

  const deactivateInspector = async () => {
    if (!deactivationTarget) return;
    const target = deactivationTarget;
    setDeactivating(true);
    setDeactivationFeedback(null);
    try {
      await deactivateMeterInspector(target.readerCode);
      setInspectors((current) => current.map((inspector) =>
        inspector.readerCode === target.readerCode
          ? { ...inspector, isActive: false }
          : inspector,
      ));
      setSelectedDeactivationInspector((current) => current?.readerCode === target.readerCode
        ? { ...current, isActive: false }
        : current);
      setDeactivationFeedback({ message: t.adminInspectorDeactivated, success: true });
      setDeactivationTarget(null);
    } catch {
      setDeactivationFeedback({ message: t.adminInspectorDeactivateFailed, success: false });
    } finally {
      setDeactivating(false);
    }
  };

  const currentReadingList = readingTab === 'Pending'
    ? pendingReadings
    : readingTab === 'Completed'
      ? approvedReadings
      : rejectedReadings;
  const filteredInspectors = inspectors.filter((inspector) =>
    `${inspector.readerCode} ${inspector.name}`
      .toLowerCase()
      .includes(inspectorSearchQuery.trim().toLowerCase()),
  );
  const filteredDeactivationInspectors = inspectors.filter((inspector) =>
    `${inspector.readerCode} ${inspector.name}`
      .toLowerCase()
      .includes(deactivationQuery.trim().toLowerCase()),
  );
  const allPendingSelected = pendingReadings.length > 0 && selectedReadingIds.length === pendingReadings.length;

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t.adminDashboard}</Text>
          <Text style={styles.subtitle}>{t.adminPanelDescription}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" onPress={() => { void loadInspectors(); void loadReadings(); }} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{t.adminRefreshList}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void onSignOut()} style={styles.signOutButton}>
            <Text style={styles.signOutText}>{t.adminSignOut}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.navigation}>
        {([
          ['overview', t.adminOverview],
          ['readings', t.adminApproveMeterReadings],
          ['passwords', t.adminAssignInspectorPassword],
          ['create', t.adminCreateMiAccount],
          ['deactivate', t.adminDeactivateAccount],
        ] as const).map(([section, label]) => (
          <Pressable
            key={section}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeSection === section }}
            onPress={() => setActiveSection(section)}
            style={[styles.navigationItem, activeSection === section && styles.navigationItemActive]}
          >
            <Text style={[styles.navigationText, activeSection === section && styles.navigationTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {loadError ? <Text accessibilityRole="alert" style={styles.error}>{loadError}</Text> : null}

      <ScrollView
        style={styles.adminMainScroll}
        contentContainerStyle={styles.adminMainScrollContent}
        keyboardShouldPersistTaps="handled"
      >
      {activeSection === 'overview' ? (
        <View style={styles.overviewGrid}>
          <Pressable onPress={() => { setReadingTab('Pending'); setActiveSection('readings'); }} style={styles.overviewCard}>
            <Text style={styles.overviewCount}>{pendingReadings.length}</Text>
            <Text style={styles.overviewLabel}>{t.adminPendingReadings}</Text>
          </Pressable>
          <Pressable onPress={() => { setReadingTab('Completed'); setActiveSection('readings'); }} style={styles.overviewCard}>
            <Text style={styles.overviewCount}>{approvedReadings.length}</Text>
            <Text style={styles.overviewLabel}>{t.adminApprovedReadings}</Text>
          </Pressable>
          <Pressable onPress={() => { setReadingTab('Rejected'); setActiveSection('readings'); }} style={styles.overviewCard}>
            <Text style={styles.overviewCount}>{rejectedReadings.length}</Text>
            <Text style={styles.overviewLabel}>{t.adminRejectedReadings}</Text>
          </Pressable>
          <Pressable onPress={() => setActiveSection('passwords')} style={styles.overviewCard}>
            <Text style={styles.overviewCount}>{inspectors.length}</Text>
            <Text style={styles.overviewLabel}>{t.adminAssignInspectorPassword}</Text>
          </Pressable>
        </View>
      ) : null}

      {activeSection === 'readings' ? (
        <View style={styles.section}>
          <View style={styles.reviewHeading}>
            <Text style={styles.reviewTitle}>{t.adminApproveMeterReadings}</Text>
            <Text style={styles.readerCode}>{currentReadingList.length}</Text>
          </View>
          <View style={styles.readingTabs}>
            {(['Pending', 'Completed', 'Rejected'] as const).map((tab) => {
              const count = tab === 'Pending' ? pendingReadings.length : tab === 'Completed' ? approvedReadings.length : rejectedReadings.length;
              const label = tab === 'Pending' ? t.adminPendingReadings : tab === 'Completed' ? t.adminApprovedReadings : t.adminRejectedReadings;
              return (
                <Pressable
                  key={tab}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: readingTab === tab }}
                  onPress={() => { setReadingTab(tab); setSelectedReadingIds([]); }}
                  style={[styles.readingTab, readingTab === tab && styles.readingTabActive]}
                >
                  <Text style={[styles.readingTabText, readingTab === tab && styles.readingTabTextActive]}>{label} · {count}</Text>
                </Pressable>
              );
            })}
          </View>
          {readingTab === 'Pending' ? (
            <View style={styles.bulkToolbar}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: allPendingSelected }}
                onPress={() => setSelectedReadingIds(allPendingSelected ? [] : pendingReadings.map((reading) => reading.id))}
                style={styles.selectAllButton}
              >
                <Text style={styles.selectAllText}>{allPendingSelected ? '☑' : '□'}  {t.adminSelectAll}</Text>
              </Pressable>
              <Text style={styles.readerCode}>{selectedReadingIds.length} {t.adminSelectedCount}</Text>
              <Pressable
                accessibilityRole="button"
                disabled={selectedReadingIds.length === 0 || bulkUpdating}
                onPress={() => void updateSelectedReadings('approve')}
                style={[styles.saveButton, (selectedReadingIds.length === 0 || bulkUpdating) && styles.saveButtonDisabled]}
              >
                <Text style={styles.saveButtonText}>{t.adminApproveReading}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={selectedReadingIds.length === 0 || bulkUpdating}
                onPress={() => void updateSelectedReadings('reject')}
                style={[styles.rejectButton, (selectedReadingIds.length === 0 || bulkUpdating) && styles.saveButtonDisabled]}
              >
                <Text style={styles.rejectButtonText}>{t.adminRejectSelected}</Text>
              </Pressable>
            </View>
          ) : null}
          {pendingLoading ? <View style={styles.status}><ActivityIndicator /><Text style={styles.statusText}>{t.adminLoadingReadings}</Text></View> : null}
          {pendingError ? <Text accessibilityRole="alert" style={styles.error}>{pendingError}</Text> : null}
          {approvalError ? <Text accessibilityRole="alert" style={styles.error}>{approvalError}</Text> : null}
          {!pendingLoading && !pendingError && currentReadingList.length === 0 ? (
            <Text style={styles.empty}>
              {readingTab === 'Pending' ? t.adminNoPendingReadings : readingTab === 'Completed' ? t.adminNoApprovedReadings : t.adminNoRejectedReadings}
            </Text>
          ) : null}
          <View style={styles.list}>
            {currentReadingList.map((reading) => (
              <View key={reading.id} style={styles.readingCard}>
                <View style={styles.readingCardTop}>
                  {readingTab === 'Pending' ? (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selectedReadingIds.includes(reading.id) }}
                      onPress={() => setSelectedReadingIds((current) => current.includes(reading.id)
                        ? current.filter((id) => id !== reading.id)
                        : [...current, reading.id])}
                      style={styles.readingCheckbox}
                    >
                      <Text style={styles.readingCheckboxText}>{selectedReadingIds.includes(reading.id) ? '☑' : '□'}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable accessibilityRole="button" onPress={() => setReadingDetails(reading)} style={styles.readingSummary}>
                    <Text style={styles.name}>{reading.customerName}</Text>
                    <Text style={styles.readerCode}>RICODE: {reading.readerCode}</Text>
                    <Text style={styles.readerCode}>{t.accountNumber}: {reading.accountNo} · {t.meter}: {reading.meterNo || '—'} · {t.ward}: {reading.wardNo || '—'}</Text>
                    <Text style={styles.readerCode}>{t.currentBill}: ৳{Number(reading.currentBill).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                    <Text style={styles.readerCode}>{new Date(reading.createdAt).toLocaleString()}</Text>
                  </Pressable>
                </View>
                <View style={styles.readingActions}>
                  <Text style={reading.status === 'Completed' ? styles.statusEnabled : reading.status === 'Rejected' ? styles.statusDisabled : styles.readerCode}>
                    {reading.status === 'Completed' ? t.adminApprovedReadings : reading.status === 'Rejected' ? t.adminRejectedReadings : t.adminPendingReadings}
                  </Text>
                  <Pressable accessibilityRole="button" onPress={() => setReadingDetails(reading)} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>{t.adminReadingDetails}</Text>
                  </Pressable>
                  {readingTab === 'Pending' ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        disabled={approvingReadingId !== null || bulkUpdating}
                        onPress={() => void approveReading(reading.id)}
                        style={[styles.saveButton, (approvingReadingId !== null || bulkUpdating) && styles.saveButtonDisabled]}
                      >
                        <Text style={styles.saveButtonText}>{approvingReadingId === reading.id ? t.adminApprovingReading : t.adminApproveReading}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={approvingReadingId !== null || bulkUpdating}
                        onPress={() => void rejectReading(reading.id)}
                        style={[styles.rejectButton, (approvingReadingId !== null || bulkUpdating) && styles.saveButtonDisabled]}
                      >
                        <Text style={styles.rejectButtonText}>{t.adminRejectReading}</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {activeSection === 'passwords' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.adminAssignInspectorPassword}</Text>
          <Text style={styles.readerCode}>{t.adminSelectInspectorHint}</Text>
          <View style={styles.searchRow}>
            <TextInput
              accessibilityLabel={t.adminSearchByRicCode}
              onChangeText={(value) => {
                setInspectorSearch(value);
                setInspectorSearchQuery(value.trim());
                setSelectedPasswordInspector(null);
                setPasswordEditorOpen(false);
                setFeedback(null);
              }}
              onSubmitEditing={() => {
                setInspectorSearchQuery(inspectorSearch.trim());
                setSelectedPasswordInspector(null);
                setPasswordEditorOpen(false);
              }}
              placeholder={t.adminSearchByRicCode}
              style={[styles.searchInput, styles.searchInputFlex]}
              value={inspectorSearch}
              returnKeyType="search"
            />
            <Pressable accessibilityRole="button" accessibilityLabel={t.search} onPress={() => {
              setInspectorSearchQuery(inspectorSearch.trim());
              setSelectedPasswordInspector(null);
              setPasswordEditorOpen(false);
              setFeedback(null);
            }} style={styles.searchButton}>
              <Text style={styles.searchButtonText}>{t.search}</Text>
            </Pressable>
            {inspectorSearch || inspectorSearchQuery ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t.adminClearSearch} onPress={() => {
                setInspectorSearch('');
                setInspectorSearchQuery('');
                setSelectedPasswordInspector(null);
                setPasswordEditorOpen(false);
                setFeedback(null);
              }} style={styles.clearSearchButton}>
                <Text style={styles.clearSearchText}>{t.adminClearSearch}</Text>
              </Pressable>
            ) : null}
          </View>
          {loading ? <View style={styles.status}><ActivityIndicator /><Text style={styles.statusText}>{t.adminLoadingInspectors}</Text></View> : null}
          {loadError ? <Text accessibilityRole="alert" style={styles.error}>{loadError}</Text> : null}
          <View style={styles.list}>
            {filteredInspectors.map((inspector) => {
              const selected = selectedPasswordInspector?.readerCode === inspector.readerCode;
              const fields = passwordFields[inspector.readerCode] ?? { password: '', confirmation: '' };
              const saving = savingCode === inspector.readerCode;
              const canSave = fields.password.length >= 12 && fields.password === fields.confirmation && !saving;
              const visible = visiblePasswordCodes[inspector.readerCode] ?? false;
              return (
                <View key={inspector.readerCode} style={styles.inspectorPasswordItem}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setSelectedPasswordInspector(inspector);
                      setPasswordEditorOpen(true);
                      setFeedback(null);
                    }}
                    style={[styles.card, selected && styles.cardSelected]}
                  >
                    <View style={styles.identity}>
                      <Text style={styles.name}>{inspector.name || inspector.readerCode}</Text>
                      <Text style={styles.readerCode}>RICODE: {inspector.readerCode}</Text>
                      {inspector.phoneNumber ? <Text style={styles.readerCode}>{t.adminInspectorPhone}: {inspector.phoneNumber}</Text> : null}
                      {inspector.email ? <Text style={styles.readerCode}>{t.adminInspectorEmail}: {inspector.email}</Text> : null}
                      <Text style={!inspector.passwordConfigured ? styles.statusDisabled : inspector.isActive ? styles.statusEnabled : styles.statusDisabled}>
                        {!inspector.passwordConfigured ? t.adminPasswordMissing : inspector.isActive ? t.adminPasswordReady : t.adminPasswordDisabled}
                      </Text>
                    </View>
                  </Pressable>
                  {selected ? (
                    <View style={styles.passwordEditor}>
                      {passwordEditorOpen ? (
                        <>
                          <Text style={styles.inputLabel}>{t.adminPasswordInput}</Text>
                          <View style={styles.passwordRow}>
                            <TextInput accessibilityLabel={`${t.adminPasswordInput} for ${inspector.readerCode}`} autoCapitalize="none" onChangeText={(value) => updatePasswordField(inspector.readerCode, 'password', value)} placeholder={t.adminPasswordInput} secureTextEntry={!visible} style={[styles.passwordInput, styles.passwordInputFlex]} value={fields.password} />
                            <Pressable accessibilityRole="button" accessibilityLabel={visible ? t.hidePassword : t.showPassword} onPress={() => setVisiblePasswordCodes((current) => ({ ...current, [inspector.readerCode]: !visible }))} style={styles.visibilityButton}>
                              <Text style={styles.visibilityIcon}>{visible ? '◉' : '◎'}</Text>
                            </Pressable>
                          </View>
                          <Text style={styles.inputLabel}>{t.adminConfirmPassword}</Text>
                          <View style={styles.passwordRow}>
                            <TextInput accessibilityLabel={`${t.adminConfirmPassword} for ${inspector.readerCode}`} autoCapitalize="none" onChangeText={(value) => updatePasswordField(inspector.readerCode, 'confirmation', value)} placeholder={t.adminConfirmPassword} secureTextEntry={!visible} style={[styles.passwordInput, styles.passwordInputFlex]} value={fields.confirmation} />
                            <Pressable accessibilityRole="button" accessibilityLabel={visible ? t.hidePassword : t.showPassword} onPress={() => setVisiblePasswordCodes((current) => ({ ...current, [inspector.readerCode]: !visible }))} style={styles.visibilityButton}>
                              <Text style={styles.visibilityIcon}>{visible ? '◉' : '◎'}</Text>
                            </Pressable>
                          </View>
                          <View style={styles.actionRow}>
                            <Pressable accessibilityRole="button" disabled={!canSave} onPress={() => void savePassword(inspector.readerCode)} style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}>
                              <Text style={styles.saveButtonText}>{saving ? t.adminSavingPassword : inspector.passwordConfigured ? t.adminResetPassword : t.adminSetPassword}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" disabled={saving} onPress={() => { setSelectedPasswordInspector(null); setPasswordEditorOpen(false); setFeedback(null); }} style={styles.secondaryButton}>
                              <Text style={styles.secondaryButtonText}>{t.adminCancelAction}</Text>
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <View style={styles.actionRow}>
                          <Pressable accessibilityRole="button" onPress={() => setPasswordEditorOpen(true)} style={styles.saveButton}>
                            <Text style={styles.saveButtonText}>{inspector.passwordConfigured ? t.adminResetPassword : t.adminSetPassword}</Text>
                          </Pressable>
                          <Pressable accessibilityRole="button" onPress={() => setSelectedPasswordInspector(null)} style={styles.secondaryButton}>
                            <Text style={styles.secondaryButtonText}>{t.adminCancelAction}</Text>
                          </Pressable>
                        </View>
                      )}
                      {feedback?.readerCode === inspector.readerCode ? <Text accessibilityRole={feedback.message === t.adminPasswordSaved ? 'text' : 'alert'} style={feedback.message === t.adminPasswordSaved ? styles.success : styles.error}>{feedback.message}</Text> : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {!loading && !loadError && filteredInspectors.length === 0 ? <Text style={styles.empty}>{t.adminNoInspectors}</Text> : null}
          </View>
        </View>
      ) : null}

      {activeSection === 'create' ? (
        <View style={styles.formSection}>
          <Text style={styles.sectionTitle}>{t.adminCreateMiAccount}</Text>
          <Text style={styles.inputLabel}>{t.employeeName}</Text>
          <TextInput accessibilityLabel={t.employeeName} placeholder={t.employeeName} value={newInspector.name} onChangeText={(name) => setNewInspector((current) => ({ ...current, name }))} style={styles.passwordInput} />
          <Text style={styles.inputLabel}>RICODE</Text>
          <TextInput accessibilityLabel="RICODE" placeholder="RICODE" value={newInspector.readerCode} onChangeText={(readerCode) => setNewInspector((current) => ({ ...current, readerCode }))} autoCapitalize="characters" style={styles.passwordInput} />
          <Text style={styles.inputLabel}>{t.adminInspectorPhone}</Text>
          <TextInput accessibilityLabel={t.adminInspectorPhone} placeholder={t.adminInspectorPhone} value={newInspector.phoneNumber} onChangeText={(phoneNumber) => setNewInspector((current) => ({ ...current, phoneNumber }))} keyboardType="phone-pad" style={styles.passwordInput} />
          <Text style={styles.inputLabel}>{t.adminInspectorEmail}</Text>
          <TextInput accessibilityLabel={t.adminInspectorEmail} placeholder={t.adminInspectorEmail} value={newInspector.email} onChangeText={(email) => setNewInspector((current) => ({ ...current, email }))} keyboardType="email-address" autoCapitalize="none" style={styles.passwordInput} />
          <Text style={styles.inputLabel}>{t.adminPasswordInput}</Text>
          <View style={styles.passwordRow}>
            <TextInput accessibilityLabel={t.adminPasswordInput} placeholder={t.adminPasswordInput} value={newInspector.password} onChangeText={(password) => setNewInspector((current) => ({ ...current, password }))} secureTextEntry={!newInspectorVisible} style={[styles.passwordInput, styles.passwordInputFlex]} />
            <Pressable accessibilityRole="button" accessibilityLabel={newInspectorVisible ? t.hidePassword : t.showPassword} onPress={() => setNewInspectorVisible((visible) => !visible)} style={styles.visibilityButton}>
              <Text style={styles.visibilityIcon}>{newInspectorVisible ? '◉' : '◎'}</Text>
            </Pressable>
          </View>
          <Text style={styles.inputLabel}>{t.adminConfirmPassword}</Text>
          <TextInput accessibilityLabel={t.adminConfirmPassword} placeholder={t.adminConfirmPassword} value={newInspector.confirmation} onChangeText={(confirmation) => setNewInspector((current) => ({ ...current, confirmation }))} secureTextEntry={!newInspectorVisible} style={styles.passwordInput} />
          {newInspectorFeedback ? <Text accessibilityRole={newInspectorFeedback.success ? 'text' : 'alert'} style={newInspectorFeedback.success ? styles.success : styles.error}>{newInspectorFeedback.message}</Text> : null}
          <Pressable accessibilityRole="button" disabled={newInspectorSaving} onPress={() => void createInspector()} style={[styles.saveButton, newInspectorSaving && styles.saveButtonDisabled]}>
            <Text style={styles.saveButtonText}>{newInspectorSaving ? t.adminSavingPassword : t.adminCreateMiAccount}</Text>
          </Pressable>
        </View>
      ) : null}

      {activeSection === 'deactivate' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.adminDeactivateAccount}</Text>
          <Text style={styles.readerCode}>{t.adminSelectInspectorHint}</Text>
          <View style={styles.searchRow}>
            <TextInput
              accessibilityLabel={t.adminSearchByRicCode}
              placeholder={t.adminSearchByRicCode}
              value={deactivationSearch}
              onChangeText={(value) => {
                setDeactivationSearch(value);
                setDeactivationQuery(value.trim());
                setSelectedDeactivationInspector(null);
                setDeactivationFeedback(null);
              }}
              onSubmitEditing={() => {
                setDeactivationQuery(deactivationSearch.trim());
                setSelectedDeactivationInspector(null);
                setDeactivationFeedback(null);
              }}
              style={[styles.searchInput, styles.searchInputFlex]}
              returnKeyType="search"
            />
            <Pressable accessibilityRole="button" accessibilityLabel={t.search} onPress={() => {
              setDeactivationQuery(deactivationSearch.trim());
              setSelectedDeactivationInspector(null);
              setDeactivationFeedback(null);
            }} style={styles.searchButton}>
              <Text style={styles.searchButtonText}>{t.search}</Text>
            </Pressable>
            {deactivationSearch || deactivationQuery ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t.adminClearSearch} onPress={() => {
                setDeactivationSearch('');
                setDeactivationQuery('');
                setSelectedDeactivationInspector(null);
                setDeactivationFeedback(null);
              }} style={styles.clearSearchButton}>
                <Text style={styles.clearSearchText}>{t.adminClearSearch}</Text>
              </Pressable>
            ) : null}
          </View>
          {loading ? <View style={styles.status}><ActivityIndicator /><Text style={styles.statusText}>{t.adminLoadingInspectors}</Text></View> : null}
          <View style={styles.deactivationResults}>
            {filteredDeactivationInspectors.map((inspector) => {
              const selected = selectedDeactivationInspector?.readerCode === inspector.readerCode;
              const canDeactivate = inspector.passwordConfigured && inspector.isActive;
              return (
                <View key={inspector.readerCode} style={styles.deactivationItem}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setSelectedDeactivationInspector(inspector);
                      setDeactivationFeedback(null);
                    }}
                    style={[styles.deactivationResult, selected && styles.cardSelected]}
                  >
                    <Text style={styles.name}>{inspector.name || inspector.readerCode}</Text>
                    <Text style={styles.readerCode}>RICODE: {inspector.readerCode}</Text>
                    <Text style={!inspector.passwordConfigured ? styles.statusDisabled : inspector.isActive ? styles.statusEnabled : styles.statusDisabled}>
                      {!inspector.passwordConfigured ? t.adminPasswordMissing : inspector.isActive ? t.adminPasswordReady : t.adminPasswordDisabled}
                    </Text>
                  </Pressable>
                  {selected ? (
                    <View style={styles.deactivationActions}>
                      {inspector.phoneNumber ? <Text style={styles.readerCode}>{t.adminInspectorPhone}: {inspector.phoneNumber}</Text> : null}
                      {inspector.email ? <Text style={styles.readerCode}>{t.adminInspectorEmail}: {inspector.email}</Text> : null}
                      {!canDeactivate ? <Text style={styles.statusDisabled}>{t.adminNoActiveInspectorAccount}</Text> : null}
                      <View style={styles.actionRow}>
                        <Pressable accessibilityRole="button" onPress={() => setSelectedDeactivationInspector(null)} style={styles.secondaryButton}>
                          <Text style={styles.secondaryButtonText}>{t.adminCancelAction}</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          disabled={!canDeactivate}
                          onPress={() => setDeactivationTarget(inspector)}
                          style={[styles.rejectButton, !canDeactivate && styles.saveButtonDisabled]}
                        >
                          <Text style={styles.rejectButtonText}>{t.adminDeactivateAccount}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
            {!loading && !loadError && filteredDeactivationInspectors.length === 0 ? <Text style={styles.empty}>{t.adminNoInspectors}</Text> : null}
          </View>
          {deactivationFeedback ? <Text accessibilityRole={deactivationFeedback.success ? 'text' : 'alert'} style={deactivationFeedback.success ? styles.success : styles.error}>{deactivationFeedback.message}</Text> : null}
        </View>
      ) : null}

      </ScrollView>
      <View style={styles.adminFooter}>
        <View style={styles.adminFooterAccent} />
        <Text style={styles.adminFooterText}>CWASA · {t.adminDashboard}</Text>
      </View>

      <Modal transparent visible={readingDetails !== null} animationType="fade" onRequestClose={() => setReadingDetails(null)}>
        <View style={styles.modalOverlay}>
          <Pressable accessibilityLabel={t.adminCancelAction} onPress={() => setReadingDetails(null)} style={styles.modalScrim} />
          {readingDetails ? (
            <View style={styles.detailModal}>
              <ScrollView contentContainerStyle={styles.detailContent}>
                <View style={styles.detailHeader}>
                  <Text style={styles.reviewTitle}>{t.adminReadingDetails}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t.adminCancelAction} onPress={() => setReadingDetails(null)} style={styles.modalClose}>
                    <Text style={styles.modalCloseText}>×</Text>
                  </Pressable>
                </View>
                <Text style={styles.name}>{readingDetails.customerName}</Text>
                <Text style={styles.readerCode}>RICODE: {readingDetails.readerCode}</Text>
                <Text style={styles.readerCode}>{t.accountNumber}: {readingDetails.accountNo}</Text>
                <Text style={styles.readerCode}>{t.meter}: {readingDetails.meterNo || '—'}</Text>
                <Text style={styles.readerCode}>{t.ward}: {readingDetails.wardNo || '—'}</Text>
                <Text style={styles.readerCode}>{t.currentBill}: ৳{Number(readingDetails.currentBill).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                <Text style={styles.readerCode}>GPS: {readingDetails.latitude}, {readingDetails.longitude}</Text>
                <Text style={styles.readerCode}>{new Date(readingDetails.createdAt).toLocaleString()}</Text>
                <Text style={styles.readerCode}>{readingDetails.status}</Text>
                {readingDetails.photoBase64 ? <Image accessibilityLabel={`${t.meterPhotoLabel} for ${readingDetails.customerName}`} source={{ uri: `data:image/jpeg;base64,${readingDetails.photoBase64}` }} style={styles.readingPhoto} resizeMode="contain" /> : <Text style={styles.statusDisabled}>{t.adminReadingPhotoMissing}</Text>}
                {readingDetails.status === 'Pending' ? (
                  <View style={styles.actionRow}>
                    <Pressable accessibilityRole="button" onPress={() => void approveReading(readingDetails.id)} style={styles.saveButton}><Text style={styles.saveButtonText}>{t.adminApproveReading}</Text></Pressable>
                    <Pressable accessibilityRole="button" onPress={() => void rejectReading(readingDetails.id)} style={styles.rejectButton}><Text style={styles.rejectButtonText}>{t.adminRejectReading}</Text></Pressable>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal transparent visible={deactivationTarget !== null} animationType="fade" onRequestClose={() => setDeactivationTarget(null)}>
        <View style={styles.modalOverlay}>
          <Pressable accessibilityLabel={t.adminCancelAction} disabled={deactivating} onPress={() => setDeactivationTarget(null)} style={styles.modalScrim} />
          <View style={styles.confirmModal}>
            <Text style={styles.reviewTitle}>{t.adminDeactivateAccount}</Text>
            <Text style={styles.subtitle}>{t.adminDeactivateConfirmation}</Text>
            <Text style={styles.name}>{deactivationTarget?.name} · {deactivationTarget?.readerCode}</Text>
            {deactivationFeedback && !deactivationFeedback.success ? <Text accessibilityRole="alert" style={styles.error}>{deactivationFeedback.message}</Text> : null}
            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" disabled={deactivating} onPress={() => setDeactivationTarget(null)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t.adminCancelAction}</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={deactivating} onPress={() => void deactivateInspector()} style={[styles.rejectButton, deactivating && styles.saveButtonDisabled]}><Text style={styles.rejectButtonText}>{deactivating ? t.adminDeactivatingAccount : t.adminDeactivateAccount}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#F4F6FB',
    padding: 16,
    gap: 12,
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DDE3EF',
    borderLeftColor: '#086f83',
    borderLeftWidth: 4,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
  },
  headerText: {
    flex: 1,
    minWidth: 220,
    gap: 4,
  },
  title: {
    color: '#151434',
    fontSize: 23,
    fontWeight: '700',
  },
  subtitle: {
    color: '#5B6275',
    fontSize: 14,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  secondaryButton: {
    borderColor: '#b9c9d7',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: '#18324b',
    fontWeight: '600',
  },
  signOutButton: {
    backgroundColor: '#eaf0f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  signOutText: {
    color: '#18324b',
    fontWeight: '600',
  },
  list: {
    gap: 12,
    paddingBottom: 24,
  },
  reviewSection: {
    backgroundColor: '#edf4f7',
    borderColor: '#d5e2e8',
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    maxHeight: 410,
    padding: 14,
  },
  reviewHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reviewTitle: {
    color: '#18324b',
    fontSize: 18,
    fontWeight: '700',
  },
  readingCard: {
    backgroundColor: '#fff',
    borderColor: '#dfe7ee',
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  pendingReadingsScroll: {
    maxHeight: 320,
  },
  readingPhoto: {
    alignSelf: 'flex-start',
    backgroundColor: '#f4f7fb',
    borderRadius: 8,
    height: 160,
    width: '100%',
  },
  card: {
    backgroundColor: '#fff',
    borderColor: '#dfe7ee',
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  identity: {
    gap: 3,
    marginBottom: 2,
  },
  name: {
    color: '#18324b',
    fontSize: 17,
    fontWeight: '700',
  },
  readerCode: {
    color: '#607488',
    fontSize: 13,
  },
  statusEnabled: {
    color: '#157347',
    fontSize: 13,
    fontWeight: '600',
  },
  statusDisabled: {
    color: '#9a5b00',
    fontSize: 13,
    fontWeight: '600',
  },
  passwordInput: {
    backgroundColor: '#fff',
    borderColor: '#d7e0e8',
    borderRadius: 8,
    borderWidth: 1,
    color: '#18324b',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  inputLabel: {
    color: '#365368',
    fontSize: 13,
    fontWeight: '600',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#086f83',
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  saveButtonDisabled: {
    backgroundColor: '#96aab5',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  status: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  statusText: {
    color: '#607488',
  },
  error: {
    color: '#b42318',
    fontSize: 13,
  },
  success: {
    color: '#157347',
    fontSize: 13,
  },
  empty: {
    color: '#607488',
    paddingVertical: 20,
    textAlign: 'center',
  },
  navigation: {
    alignItems: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 2,
  },
  navigationItem: {
    alignItems: 'center',
    borderColor: '#cbd7e0',
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 135,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  navigationItemActive: {
    backgroundColor: '#E7F1FE',
    borderColor: '#006AD8',
  },
  navigationText: {
    color: '#52697a',
    fontWeight: '600',
    textAlign: 'center',
  },
  navigationTextActive: {
    color: '#0058B6',
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingBottom: 24,
  },
  overviewCard: {
    backgroundColor: '#fff',
    borderColor: '#dfe7ee',
    borderRadius: 10,
    borderWidth: 1,
    flexBasis: 220,
    flexGrow: 1,
    gap: 6,
    padding: 18,
  },
  overviewCount: {
    color: '#086f83',
    fontSize: 25,
    fontWeight: '700',
  },
  overviewLabel: {
    color: '#365368',
    fontWeight: '600',
  },
  section: {
    gap: 12,
  },
  sectionScroll: {
    flex: 1,
  },
  formSection: {
    gap: 12,
    maxWidth: 640,
    paddingBottom: 24,
    width: '100%',
    alignSelf: 'center',
  },
  sectionTitle: {
    color: '#18324b',
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 4,
  },
  readingTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  readingTab: {
    backgroundColor: '#fff',
    borderColor: '#cbd7e0',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  readingTabActive: {
    backgroundColor: '#e7f1f4',
    borderColor: '#086f83',
  },
  readingTabText: {
    color: '#52697a',
    fontWeight: '600',
  },
  readingTabTextActive: {
    color: '#086f83',
  },
  bulkToolbar: {
    alignItems: 'center',
    backgroundColor: '#edf4f7',
    borderRadius: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 10,
  },
  selectAllButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  selectAllText: {
    color: '#365368',
    fontWeight: '600',
  },
  readingList: {
    flex: 1,
    minHeight: 0,
  },
  readingCardTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  readingCheckbox: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 40,
  },
  readingCheckboxText: {
    color: '#086f83',
    fontSize: 20,
  },
  readingSummary: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  readingActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  rejectButton: {
    alignItems: 'center',
    backgroundColor: '#b42318',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  rejectButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  searchInput: {
    backgroundColor: '#fff',
    borderColor: '#d7e0e8',
    borderRadius: 8,
    borderWidth: 1,
    color: '#18324b',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  searchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchInputFlex: {
    flex: 1,
    minWidth: 160,
  },
  searchButton: {
    alignItems: 'center',
    backgroundColor: '#0058B6',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  clearSearchButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
  },
  clearSearchText: {
    color: '#0058B6',
    fontWeight: '600',
  },
  inspectorPasswordItem: {
    gap: 8,
  },
  passwordEditor: {
    backgroundColor: '#f7fafd',
    borderColor: '#dfe7ee',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  inspectorList: {
    flex: 1,
    minHeight: 0,
  },
  passwordRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  passwordInputFlex: {
    flex: 1,
    minWidth: 0,
  },
  visibilityButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    width: 44,
  },
  visibilityIcon: {
    color: '#365368',
    fontSize: 20,
  },
  cardSelected: {
    borderColor: '#086f83',
    borderWidth: 2,
  },
  deactivationActions: {
    backgroundColor: '#fff',
    borderColor: '#dfe7ee',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  deactivationResults: {
    gap: 8,
  },
  deactivationItem: {
    gap: 8,
  },
  deactivationResult: {
    backgroundColor: '#fff',
    borderColor: '#dfe7ee',
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  modalOverlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  modalScrim: {
    backgroundColor: 'rgba(14,20,48,0.52)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  detailModal: {
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: '90%',
    maxWidth: 620,
    width: '92%',
  },
  detailContent: {
    gap: 10,
    padding: 18,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalClose: {
    alignItems: 'center',
    backgroundColor: '#edf2f5',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  modalCloseText: {
    color: '#365368',
    fontSize: 22,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  confirmModal: {
    backgroundColor: '#fff',
    borderRadius: 12,
    gap: 14,
    maxWidth: 440,
    padding: 20,
    width: '90%',
  },
  adminMainScroll: {
    flex: 1,
    minHeight: 0,
  },
  adminMainScrollContent: {
    flexGrow: 1,
    gap: 16,
    paddingBottom: 8,
  },
  adminFooter: {
    borderTopColor: '#DDE3EF',
    borderTopWidth: 1,
    gap: 3,
    marginTop: 2,
    paddingTop: 5,
    paddingBottom: 2,
  },
  adminFooterAccent: {
    backgroundColor: '#006AD8',
    borderRadius: 2,
    height: 2,
    width: 32,
  },
  adminFooterText: {
    color: '#607488',
    fontSize: 10,
  },
});
