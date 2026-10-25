import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput,
  type TextProps,
  View,
} from 'react-native';
import {
  approveMeterReading,
  createBillTariff,
  createMeterInspector,
  createVatRate,
  getAdminInspectors,
  getAdminMeterReadings,
  rejectMeterReading,
  setMeterInspectorPassword,
  type AdminInspector,
  type AdminMeterReading,
} from './api';
import { LANG, type Language } from './translations';

function Text({ style, ...props }: TextProps) {
  const fontWeight = StyleSheet.flatten(style)?.fontWeight;
  const isBold = fontWeight === 'bold' ||
    (typeof fontWeight === 'string' && Number(fontWeight) >= 600) ||
    (typeof fontWeight === 'number' && fontWeight >= 600);

  return (
    <NativeText
      {...props}
      style={[style, { fontFamily: isBold ? 'Open Sans Bold' : 'Open Sans' }]}
    />
  );
}

type AdminPanelProps = {
  language: Language;
  onOpenMenu: () => void;
};

type PasswordFields = {
  password: string;
  confirmation: string;
};

type AdminSection = 'overview' | 'readings' | 'passwords' | 'rates' | 'deactivate';
type PasswordSubsection = 'add-mi' | 'set-password';
type RateSubsection = 'tariff' | 'vat';
type ReadingTab = 'Pending' | 'Completed' | 'Rejected';
type BillTariffCategory = 'RESIDENTIAL' | 'NON_RESIDENTIAL';
type NewInspectorFields = {
  readerCode: string;
};

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateInputToIsoDateTime(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  if (value < new Date().toISOString().slice(0, 10)) return null;
  return date.toISOString();
}

export default function AdminPanel({ language, onOpenMenu }: AdminPanelProps) {
  const t = LANG[language];
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [passwordSubsection, setPasswordSubsection] = useState<PasswordSubsection>('set-password');
  const [rateSubsection, setRateSubsection] = useState<RateSubsection>('tariff');
  const [tariffFields, setTariffFields] = useState({
    category: 'RESIDENTIAL' as BillTariffCategory,
    description: '',
    ratePerM3: '',
    minUnitsPerDay: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
  });
  const [vatFields, setVatFields] = useState({
    percentage: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
  });
  const [rateSaving, setRateSaving] = useState(false);
  const [rateFeedback, setRateFeedback] = useState<{ message: string; success: boolean } | null>(null);
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
  const [pendingReadings, setPendingReadings] = useState<AdminMeterReading[]>([]);
  const [approvedReadings, setApprovedReadings] = useState<AdminMeterReading[]>([]);
  const [rejectedReadings, setRejectedReadings] = useState<AdminMeterReading[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState('');
  const [readingTab, setReadingTab] = useState<ReadingTab>('Pending');
  const [selectedReadingIds, setSelectedReadingIds] = useState<string[]>([]);
  const [readingDetails, setReadingDetails] = useState<AdminMeterReading | null>(null);
  const [approvalTargetIds, setApprovalTargetIds] = useState<string[]>([]);
  const [billIssueDate, setBillIssueDate] = useState(() => formatDateInput(new Date()));
  const [billDueDate, setBillDueDate] = useState(() => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    return formatDateInput(dueDate);
  });
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [rejectionTargetIds, setRejectionTargetIds] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectionSaving, setRejectionSaving] = useState(false);
  const [newInspector, setNewInspector] = useState<NewInspectorFields>({ readerCode: '' });
  const [newInspectorSaving, setNewInspectorSaving] = useState(false);
  const [newInspectorFeedback, setNewInspectorFeedback] = useState<{ message: string; success: boolean } | null>(null);

  const loadReadings = useCallback(async () => {
    setPendingLoading(true);
    setPendingError('');
    try {
      const readings = await getAdminMeterReadings();
      setPendingReadings(readings.filter((reading) => reading.status === null || reading.status === 'PENDING'));
      setApprovedReadings(readings.filter((reading) => reading.status === 'APPROVED'));
      setRejectedReadings(readings.filter((reading) => reading.status === 'REJECTED'));
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
      const loadedInspectors = await getAdminInspectors();
      setInspectors((current) => loadedInspectors.map((inspector) => {
        const existing = current.find((item) => item.id === inspector.id);
        return inspector.hasPassword === undefined && existing?.hasPassword !== undefined
          ? { ...inspector, hasPassword: existing.hasPassword }
          : inspector;
      }));
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

  const requestApproval = (readingIds: string[]) => {
    if (readingIds.length === 0) return;
    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 30);
    setBillIssueDate(formatDateInput(issueDate));
    setBillDueDate(formatDateInput(dueDate));
    setApprovalTargetIds(readingIds);
    setReadingDetails(null);
    setApprovalError('');
  };

  const confirmApproval = async () => {
    if (
      approvalTargetIds.length === 0 ||
      !isValidDateInput(billIssueDate) ||
      !isValidDateInput(billDueDate) ||
      billDueDate < billIssueDate
    ) {
      setApprovalError(t.adminInvalidApprovalDates);
      return;
    }

    setApprovalSaving(true);
    setApprovalError('');
    const targetIds = approvalTargetIds;
    const results = await Promise.allSettled(
      targetIds.map((readingId) => approveMeterReading(readingId, billIssueDate, billDueDate)),
    );
    await loadReadings();
    setSelectedReadingIds((current) => current.filter((id) => !targetIds.includes(id)));
    setReadingDetails(null);
    setApprovalTargetIds([]);
    if (results.some((result) => result.status === 'rejected')) {
      setApprovalError(t.adminBulkActionFailed);
    }
    setApprovalSaving(false);
  };

  const approveReading = (readingId: string) => {
    requestApproval([readingId]);
  };

  const requestRejection = (readingIds: string[]) => {
    if (readingIds.length === 0) return;
    setReadingDetails(null);
    setRejectionTargetIds(readingIds);
    setRejectReason('');
    setApprovalError('');
  };

  const confirmRejection = async () => {
    const reason = rejectReason.trim();
    if (!reason || reason.length > 500 || rejectionTargetIds.length === 0) return;
    setRejectionSaving(true);
    setApprovalError('');
    const targetIds = rejectionTargetIds;
    const results = await Promise.allSettled(
      targetIds.map((readingId) => rejectMeterReading(readingId, reason)),
    );
    await loadReadings();
    setSelectedReadingIds((current) =>
      current.filter((id) => !targetIds.includes(id)),
    );
    setReadingDetails(null);
    setRejectionTargetIds([]);
    if (results.some((result) => result.status === 'rejected')) {
      setApprovalError(t.adminBulkActionFailed);
    }
    setRejectionSaving(false);
  };

  const updateSelectedReadings = () => {
    if (selectedReadingIds.length === 0) return;
    requestApproval(selectedReadingIds);
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

  const savePassword = async (readerCode: string, meterReaderId: string) => {
    const inspector = inspectors.find((item) => item.id === meterReaderId);
    if (inspector?.hasPassword === true) {
      setFeedback({ readerCode, message: t.adminPasswordReady });
      return;
    }

    const fields = passwordFields[readerCode] ?? { password: '', confirmation: '' };
    if (fields.password.length < 8) {
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
      await setMeterInspectorPassword(meterReaderId, fields.password);
      setInspectors((current) => current.map((item) =>
        item.id === meterReaderId ? { ...item, hasPassword: true } : item,
      ));
      setSelectedPasswordInspector((current) =>
        current?.id === meterReaderId ? { ...current, hasPassword: true } : current,
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
    const readerCode = newInspector.readerCode.trim();
    if (!readerCode) {
      setNewInspectorFeedback({ message: t.completeAllFields, success: false });
      return;
    }
    setNewInspectorSaving(true);
    setNewInspectorFeedback(null);
    try {
      await createMeterInspector({
        readerCode,
      });
      await loadInspectors();
      setInspectors((current) => current.map((inspector) =>
        inspector.readerCode.toLowerCase() === readerCode.toLowerCase() &&
        inspector.hasPassword === undefined
          ? { ...inspector, hasPassword: false }
          : inspector,
      ));
      setNewInspector({ readerCode: '' });
      setNewInspectorFeedback({ message: t.adminInspectorCreated, success: true });
      setInspectorSearch(readerCode);
      setInspectorSearchQuery(readerCode);
      setSelectedPasswordInspector(null);
      setPasswordEditorOpen(false);
      setPasswordSubsection('set-password');
    } catch {
      setNewInspectorFeedback({ message: t.adminInspectorCreateFailed, success: false });
    } finally {
      setNewInspectorSaving(false);
    }
  };

  const submitTariff = async () => {
    const ratePerM3 = Number(tariffFields.ratePerM3);
    const minUnitsPerDay = Number(tariffFields.minUnitsPerDay);
    const effectiveFrom = dateInputToIsoDateTime(tariffFields.effectiveFrom);
    const description = tariffFields.description.trim();

    if (!effectiveFrom) {
      setRateFeedback({ message: t.adminDateMustBeTodayOrLater, success: false });
      return;
    }
    if (!tariffFields.ratePerM3.trim() || !Number.isFinite(ratePerM3) || ratePerM3 <= 0) {
      setRateFeedback({ message: t.adminRateMustBePositive, success: false });
      return;
    }
    if (!tariffFields.minUnitsPerDay.trim() || !Number.isFinite(minUnitsPerDay) || minUnitsPerDay < 0) {
      setRateFeedback({ message: t.adminMinUnitsInvalid, success: false });
      return;
    }
    if (description.length > 500) {
      setRateFeedback({ message: t.adminDescriptionTooLong, success: false });
      return;
    }

    setRateSaving(true);
    setRateFeedback(null);
    try {
      await createBillTariff({
        category: tariffFields.category,
        ...(description ? { description } : {}),
        ratePerM3,
        minUnitsPerDay,
        effectiveFrom,
      });
      setRateFeedback({ message: t.adminTariffCreated, success: true });
    } catch (error) {
      setRateFeedback({
        message: error instanceof Error
          ? `${t.adminBillingRateCreateFailed} (${error.message})`
          : t.adminBillingRateCreateFailed,
        success: false,
      });
    } finally {
      setRateSaving(false);
    }
  };

  const submitVatRate = async () => {
    const percentage = Number(vatFields.percentage);
    const effectiveFrom = dateInputToIsoDateTime(vatFields.effectiveFrom);
    if (!effectiveFrom) {
      setRateFeedback({ message: t.adminDateMustBeTodayOrLater, success: false });
      return;
    }
    if (!vatFields.percentage.trim() || !Number.isFinite(percentage) || percentage < 0 || percentage > 999.99) {
      setRateFeedback({ message: t.adminPercentageInvalid, success: false });
      return;
    }

    setRateSaving(true);
    setRateFeedback(null);
    try {
      await createVatRate({ percentage, effectiveFrom });
      setRateFeedback({ message: t.adminVatRateCreated, success: true });
    } catch (error) {
      setRateFeedback({
        message: error instanceof Error
          ? `${t.adminBillingRateCreateFailed} (${error.message})`
          : t.adminBillingRateCreateFailed,
        success: false,
      });
    } finally {
      setRateSaving(false);
    }
  };

  const currentReadingList = readingTab === 'Pending'
    ? pendingReadings
    : readingTab === 'Completed'
      ? approvedReadings
      : rejectedReadings;
  const filteredInspectors = inspectors.filter((inspector) =>
    `${inspector.readerCode} ${inspector.name} ${inspector.id}`
      .toLowerCase()
      .includes(inspectorSearchQuery.trim().toLowerCase()),
  );
  const allPendingSelected = pendingReadings.length > 0 && selectedReadingIds.length === pendingReadings.length;

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={t.moreOptions}
          accessibilityRole="button"
          onPress={onOpenMenu}
          style={styles.menuButton}
        >
          <Text style={styles.menuButtonText}>☰</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t.adminDashboard}</Text>
          <Text style={styles.subtitle}>{t.adminPanelDescription}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" onPress={() => { void loadInspectors(); void loadReadings(); }} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{t.adminRefreshList}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.navigation}>
        {([
          ['overview', t.adminOverview],
          ['readings', t.adminApproveMeterReadings],
          ['passwords', t.adminAssignInspectorPassword],
          ['rates', t.adminBillingRates],
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
                disabled={selectedReadingIds.length === 0 || approvalSaving}
                onPress={() => void updateSelectedReadings()}
                style={[styles.saveButton, (selectedReadingIds.length === 0 || approvalSaving) && styles.saveButtonDisabled]}
              >
                <Text style={styles.saveButtonText}>{t.adminApproveReading}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={selectedReadingIds.length === 0 || approvalSaving || rejectionSaving}
                onPress={() => requestRejection(selectedReadingIds)}
                style={[styles.rejectButton, (selectedReadingIds.length === 0 || approvalSaving || rejectionSaving) && styles.saveButtonDisabled]}
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
                    <Text style={styles.name}>{t.adminCustomerId}: {reading.customerId}</Text>
                    <Text style={styles.readerCode}>{t.adminMeterReaderName}: {reading.meterReader.name} · RICODE: {reading.meterReader.readerCode}</Text>
                    <Text style={styles.readerCode}>{t.meter}: {reading.meterNo || '—'}</Text>
                    <Text style={styles.readerCode}>{t.adminReadingAddress}: {reading.addressSnapshot}</Text>
                    <Text style={styles.readerCode}>{t.previousReading}: {reading.previousReading} · {t.currentReading}: {reading.currentReading}</Text>
                    <Text style={styles.readerCode}>{new Date(reading.readingDate).toLocaleString()}</Text>
                  </Pressable>
                </View>
                <View style={styles.readingActions}>
                  <Text style={reading.status === 'APPROVED' ? styles.statusEnabled : reading.status === 'REJECTED' ? styles.statusDisabled : styles.readerCode}>
                    {reading.status === 'APPROVED' ? t.adminApprovedReadings : reading.status === 'REJECTED' ? t.adminRejectedReadings : t.adminPendingReadings}
                  </Text>
                  <Pressable accessibilityRole="button" onPress={() => setReadingDetails(reading)} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>{t.adminReadingDetails}</Text>
                  </Pressable>
                  {readingTab === 'Pending' ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        disabled={approvalSaving || rejectionSaving}
                        onPress={() => void approveReading(reading.id)}
                        style={[styles.saveButton, (approvalSaving || rejectionSaving) && styles.saveButtonDisabled]}
                      >
                        <Text style={styles.saveButtonText}>{approvalSaving ? t.adminApprovingReading : t.adminApproveReading}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={approvalSaving || rejectionSaving}
                        onPress={() => requestRejection([reading.id])}
                        style={[styles.rejectButton, (approvalSaving || rejectionSaving) && styles.saveButtonDisabled]}
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

      {activeSection === 'rates' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.adminBillingRates}</Text>
          <View style={styles.readingTabs}>
            {([
              ['tariff', t.adminCreateTariff],
              ['vat', t.adminCreateVatRate],
            ] as const).map(([subsection, label]) => (
              <Pressable
                key={subsection}
                accessibilityRole="tab"
                accessibilityState={{ selected: rateSubsection === subsection }}
                onPress={() => {
                  setRateSubsection(subsection);
                  setRateFeedback(null);
                }}
                style={[styles.readingTab, rateSubsection === subsection && styles.readingTabActive]}
              >
                <Text style={[styles.readingTabText, rateSubsection === subsection && styles.readingTabTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {rateSubsection === 'tariff' ? (
            <View style={styles.formSection}>
              <Text style={styles.inputLabel}>{t.adminTariffCategory}</Text>
              <View style={styles.readingTabs}>
                {([
                  ['RESIDENTIAL', t.adminResidential],
                  ['NON_RESIDENTIAL', t.adminNonResidential],
                ] as const).map(([category, label]) => (
                  <Pressable
                    key={category}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: tariffFields.category === category }}
                    onPress={() => setTariffFields((current) => ({ ...current, category }))}
                    style={[styles.readingTab, tariffFields.category === category && styles.readingTabActive]}
                  >
                    <Text style={[styles.readingTabText, tariffFields.category === category && styles.readingTabTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.inputLabel}>{t.adminTariffDescription}</Text>
              <TextInput
                accessibilityLabel={t.adminTariffDescription}
                maxLength={500}
                multiline
                onChangeText={(description) => {
                  setTariffFields((current) => ({ ...current, description }));
                  setRateFeedback(null);
                }}
                placeholder={t.adminTariffDescription}
                style={[styles.passwordInput, styles.descriptionInput]}
                value={tariffFields.description}
              />
              <Text style={styles.inputLabel}>{t.adminRatePerM3}</Text>
              <TextInput
                accessibilityLabel={t.adminRatePerM3}
                keyboardType="decimal-pad"
                onChangeText={(ratePerM3) => {
                  setTariffFields((current) => ({ ...current, ratePerM3 }));
                  setRateFeedback(null);
                }}
                placeholder="25.5"
                style={styles.passwordInput}
                value={tariffFields.ratePerM3}
              />
              <Text style={styles.inputLabel}>{t.adminMinUnitsPerDay}</Text>
              <TextInput
                accessibilityLabel={t.adminMinUnitsPerDay}
                keyboardType="decimal-pad"
                onChangeText={(minUnitsPerDay) => {
                  setTariffFields((current) => ({ ...current, minUnitsPerDay }));
                  setRateFeedback(null);
                }}
                placeholder="1"
                style={styles.passwordInput}
                value={tariffFields.minUnitsPerDay}
              />
              <Text style={styles.inputLabel}>{t.adminEffectiveFrom}</Text>
              <TextInput
                accessibilityLabel={t.adminEffectiveFrom}
                autoCapitalize="none"
                onChangeText={(effectiveFrom) => {
                  setTariffFields((current) => ({ ...current, effectiveFrom }));
                  setRateFeedback(null);
                }}
                placeholder="YYYY-MM-DD"
                style={styles.passwordInput}
                value={tariffFields.effectiveFrom}
              />
              {rateFeedback ? (
                <Text accessibilityRole={rateFeedback.success ? 'text' : 'alert'} style={rateFeedback.success ? styles.success : styles.error}>
                  {rateFeedback.message}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={rateSaving}
                onPress={() => void submitTariff()}
                style={[styles.saveButton, rateSaving && styles.saveButtonDisabled]}
              >
                <Text style={styles.saveButtonText}>{rateSaving ? t.adminSaving : t.adminCreateTariff}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.formSection}>
              <Text style={styles.readerCode}>{t.adminVatInactiveNote}</Text>
              <Text style={styles.inputLabel}>{t.adminPercentage}</Text>
              <TextInput
                accessibilityLabel={t.adminPercentage}
                keyboardType="decimal-pad"
                onChangeText={(percentage) => {
                  setVatFields((current) => ({ ...current, percentage }));
                  setRateFeedback(null);
                }}
                placeholder="15"
                style={styles.passwordInput}
                value={vatFields.percentage}
              />
              <Text style={styles.inputLabel}>{t.adminEffectiveFrom}</Text>
              <TextInput
                accessibilityLabel={t.adminEffectiveFrom}
                autoCapitalize="none"
                onChangeText={(effectiveFrom) => {
                  setVatFields((current) => ({ ...current, effectiveFrom }));
                  setRateFeedback(null);
                }}
                placeholder="YYYY-MM-DD"
                style={styles.passwordInput}
                value={vatFields.effectiveFrom}
              />
              {rateFeedback ? (
                <Text accessibilityRole={rateFeedback.success ? 'text' : 'alert'} style={rateFeedback.success ? styles.success : styles.error}>
                  {rateFeedback.message}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={rateSaving}
                onPress={() => void submitVatRate()}
                style={[styles.saveButton, rateSaving && styles.saveButtonDisabled]}
              >
                <Text style={styles.saveButtonText}>{rateSaving ? t.adminSaving : t.adminCreateVatRate}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      {activeSection === 'passwords' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.adminAssignInspectorPassword}</Text>
          <View style={styles.readingTabs}>
            {([
              ['add-mi', t.adminCreateMiAccount],
              ['set-password', t.adminAddMiPassword],
            ] as const).map(([subsection, label]) => (
              <Pressable
                key={subsection}
                accessibilityRole="tab"
                accessibilityState={{ selected: passwordSubsection === subsection }}
                onPress={() => {
                  setPasswordSubsection(subsection);
                  setFeedback(null);
                  setSelectedPasswordInspector(null);
                  setPasswordEditorOpen(false);
                }}
                style={[styles.readingTab, passwordSubsection === subsection && styles.readingTabActive]}
              >
                <Text style={[styles.readingTabText, passwordSubsection === subsection && styles.readingTabTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {passwordSubsection === 'add-mi' ? (
            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>{t.adminCreateMiAccount}</Text>
              <Text style={styles.inputLabel}>{t.meterReaderCode}</Text>
              <TextInput
                accessibilityLabel={t.meterReaderCode}
                autoCapitalize="characters"
                onChangeText={(readerCode) => setNewInspector({ readerCode })}
                placeholder={t.meterReaderCode}
                style={styles.passwordInput}
                value={newInspector.readerCode}
              />
              {newInspectorFeedback ? (
                <Text accessibilityRole={newInspectorFeedback.success ? 'text' : 'alert'} style={newInspectorFeedback.success ? styles.success : styles.error}>
                  {newInspectorFeedback.message}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={newInspectorSaving}
                onPress={() => void createInspector()}
                style={[styles.saveButton, newInspectorSaving && styles.saveButtonDisabled]}
              >
                <Text style={styles.saveButtonText}>{newInspectorSaving ? t.adminSavingPassword : t.adminCreateMiAccount}</Text>
              </Pressable>
            </View>
          ) : null}
          {passwordSubsection === 'set-password' ? (
            <View style={styles.section}>
          {newInspectorFeedback?.success ? (
            <Text accessibilityRole="text" style={styles.success}>{newInspectorFeedback.message}</Text>
          ) : null}
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
              const canSave = fields.password.length >= 8 && fields.password === fields.confirmation && !saving;
              const visible = visiblePasswordCodes[inspector.readerCode] ?? false;
              return (
                <View key={inspector.readerCode} style={styles.inspectorPasswordItem}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setSelectedPasswordInspector(inspector);
                      setPasswordEditorOpen(inspector.hasPassword === false);
                      setFeedback(null);
                    }}
                    style={[styles.card, selected && styles.cardSelected]}
                  >
                    <View style={styles.identity}>
                      <Text style={styles.name}>{inspector.name || inspector.readerCode}</Text>
                      <Text style={styles.readerCode}>RICODE: {inspector.readerCode}</Text>
                      <Text style={styles.readerCode}>ID: {inspector.id}</Text>
                      <Text style={inspector.hasPassword === true ? styles.passwordStatusReady : inspector.hasPassword === false ? styles.passwordStatusMissing : styles.passwordStatusUnknown}>
                        {inspector.hasPassword === true
                          ? t.adminPasswordReady
                          : inspector.hasPassword === false
                            ? t.adminPasswordMissing
                            : t.adminPasswordStatusUnavailable}
                      </Text>
                    </View>
                  </Pressable>
                  {selected ? (
                    <View style={styles.passwordEditor}>
                      {inspector.hasPassword === true ? (
                        <Text style={styles.passwordStatusReady}>{t.adminPasswordReady}</Text>
                      ) : passwordEditorOpen ? (
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
                            <Pressable accessibilityRole="button" disabled={!canSave} onPress={() => void savePassword(inspector.readerCode, inspector.id)} style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}>
                              <Text style={styles.saveButtonText}>{saving ? t.adminSavingPassword : t.adminSetPassword}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" disabled={saving} onPress={() => { setSelectedPasswordInspector(null); setPasswordEditorOpen(false); setFeedback(null); }} style={styles.secondaryButton}>
                              <Text style={styles.secondaryButtonText}>{t.adminCancelAction}</Text>
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <View style={styles.actionRow}>
                          <Pressable accessibilityRole="button" onPress={() => setPasswordEditorOpen(true)} style={styles.saveButton}>
                            <Text style={styles.saveButtonText}>{t.adminSetPassword}</Text>
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
        </View>
      ) : null}

      {activeSection === 'deactivate' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.adminDeactivateAccount}</Text>
          <Text accessibilityRole="alert" style={styles.error}>{t.adminDeactivationUnavailable}</Text>
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
                <Text style={styles.name}>{t.adminCustomerId}: {readingDetails.customerId}</Text>
                <Text style={styles.readerCode}>{t.adminMeterReaderName}: {readingDetails.meterReader.name} · RICODE: {readingDetails.meterReader.readerCode}</Text>
                <Text style={styles.readerCode}>{t.meter}: {readingDetails.meterNo || '—'}</Text>
                <Text style={styles.readerCode}>{t.adminReadingAddress}: {readingDetails.addressSnapshot}</Text>
                <Text style={styles.readerCode}>{t.previousReading}: {readingDetails.previousReading}</Text>
                <Text style={styles.readerCode}>{t.currentReading}: {readingDetails.currentReading}</Text>
                <Text style={styles.readerCode}>GPS: {readingDetails.latitude}, {readingDetails.longitude}</Text>
                <Text style={styles.readerCode}>{new Date(readingDetails.readingDate).toLocaleString()}</Text>
                <Text style={styles.readerCode}>
                  {readingDetails.status === 'APPROVED'
                    ? t.adminApprovedReadings
                    : readingDetails.status === 'REJECTED'
                      ? t.adminRejectedReadings
                      : t.adminPendingReadings}
                </Text>
                {readingDetails.image ? <Image accessibilityLabel={`${t.meterPhotoLabel} for ${readingDetails.meterReader.name}`} source={{ uri: readingDetails.image }} style={styles.readingPhoto} resizeMode="contain" /> : <Text style={styles.statusDisabled}>{t.adminReadingPhotoMissing}</Text>}
                {readingDetails.status === null || readingDetails.status === 'PENDING' ? (
                  <View style={styles.actionRow}>
                    <Pressable accessibilityRole="button" onPress={() => void approveReading(readingDetails.id)} style={styles.saveButton}><Text style={styles.saveButtonText}>{t.adminApproveReading}</Text></Pressable>
                    <Pressable accessibilityRole="button" onPress={() => requestRejection([readingDetails.id])} style={styles.rejectButton}><Text style={styles.rejectButtonText}>{t.adminRejectReading}</Text></Pressable>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal
        transparent
        visible={approvalTargetIds.length > 0}
        animationType="fade"
        onRequestClose={() => {
          if (!approvalSaving) setApprovalTargetIds([]);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            accessibilityLabel={t.adminCancelAction}
            disabled={approvalSaving}
            onPress={() => setApprovalTargetIds([])}
            style={styles.modalScrim}
          />
          <View style={styles.confirmModal}>
            <Text style={styles.reviewTitle}>{t.adminApproveReading}</Text>
            <Text style={styles.subtitle}>
              {approvalTargetIds.length > 1
                ? `${approvalTargetIds.length} ${t.adminSelectedCount}`
                : t.adminBillDatesPrompt}
            </Text>
            <Text style={styles.inputLabel}>{t.adminBillIssueDate}</Text>
            <TextInput
              accessibilityLabel={t.adminBillIssueDate}
              autoCapitalize="none"
              editable={!approvalSaving}
              onChangeText={setBillIssueDate}
              placeholder="YYYY-MM-DD"
              style={styles.passwordInput}
              value={billIssueDate}
            />
            <Text style={styles.inputLabel}>{t.adminBillDueDate}</Text>
            <TextInput
              accessibilityLabel={t.adminBillDueDate}
              autoCapitalize="none"
              editable={!approvalSaving}
              onChangeText={setBillDueDate}
              placeholder="YYYY-MM-DD"
              style={styles.passwordInput}
              value={billDueDate}
            />
            {approvalError ? <Text accessibilityRole="alert" style={styles.error}>{approvalError}</Text> : null}
            <View style={styles.actionRow}>
              <Pressable
                accessibilityRole="button"
                disabled={approvalSaving}
                onPress={() => setApprovalTargetIds([])}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>{t.adminCancelAction}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={approvalSaving}
                onPress={() => void confirmApproval()}
                style={[styles.saveButton, approvalSaving && styles.saveButtonDisabled]}
              >
                <Text style={styles.saveButtonText}>
                  {approvalSaving ? t.adminApprovingReading : t.adminConfirmAction}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={rejectionTargetIds.length > 0} animationType="fade" onRequestClose={() => setRejectionTargetIds([])}>
        <View style={styles.modalOverlay}>
          <Pressable accessibilityLabel={t.adminCancelAction} disabled={rejectionSaving} onPress={() => setRejectionTargetIds([])} style={styles.modalScrim} />
          <View style={styles.confirmModal}>
            <Text style={styles.reviewTitle}>{t.adminRejectReading}</Text>
            <Text style={styles.subtitle}>{t.adminRejectReasonPrompt}</Text>
            <TextInput
              accessibilityLabel={t.adminRejectReasonPrompt}
              maxLength={500}
              multiline
              onChangeText={setRejectReason}
              placeholder={t.adminRejectReasonPrompt}
              style={[styles.passwordInput, styles.rejectReasonInput]}
              value={rejectReason}
            />
            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" disabled={rejectionSaving} onPress={() => setRejectionTargetIds([])} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t.adminCancelAction}</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={!rejectReason.trim() || rejectionSaving} onPress={() => void confirmRejection()} style={[styles.rejectButton, (!rejectReason.trim() || rejectionSaving) && styles.saveButtonDisabled]}><Text style={styles.rejectButtonText}>{rejectionSaving ? t.adminSaving : t.adminRejectReading}</Text></Pressable>
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
    backgroundColor: 'rgb(255, 255, 255)',
    padding: 16,
    gap: 12,
  },
  header: {
    backgroundColor: '#006BD9',
    borderColor: '#006BD9',
    borderLeftColor: '#FFC809',
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
    color: '#FFFFFF',
    fontSize: 23,
    fontWeight: '700',
  },
  subtitle: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  secondaryButton: {
    backgroundColor: '#FFC809',
    borderColor: '#FFC809',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: '#151435',
    fontWeight: '600',
  },
  menuButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFC809',
    borderRadius: 8,
  },
  menuButtonText: {
    color: '#151435',
    fontSize: 24,
    fontWeight: '700',
  },
  list: {
    gap: 12,
    paddingBottom: 24,
  },
  reviewSection: {
    backgroundColor: '#F8F0E4',
    borderColor: '#006BD9',
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
    color: '#151435',
    fontSize: 18,
    fontWeight: '700',
  },
  readingCard: {
    backgroundColor: '#ffffff',
    borderColor: '#006BD9',
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
    backgroundColor: '#F8F0E4',
    borderRadius: 8,
    height: 160,
    width: '100%',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#006BD9',
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
    color: '#151435',
    fontSize: 17,
    fontWeight: '700',
  },
  readerCode: {
    color: '#151435',
    fontSize: 13,
  },
  statusEnabled: {
    color: '#006BD9',
    fontSize: 13,
    fontWeight: '600',
  },
  statusDisabled: {
    color: '#151435',
    fontSize: 13,
    fontWeight: '600',
  },
  passwordStatusReady: {
    alignSelf: 'flex-start',
    backgroundColor: '#006BD9',
    borderRadius: 12,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  passwordStatusMissing: {
    alignSelf: 'flex-start',
    backgroundColor: '#D6FF00',
    borderRadius: 12,
    color: '#151435',
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  passwordStatusUnknown: {
    alignSelf: 'flex-start',
    backgroundColor: '#F8F0E4',
    borderColor: '#006BD9',
    borderRadius: 12,
    borderWidth: 1,
    color: '#151435',
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  passwordInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#006BD9',
    borderRadius: 8,
    borderWidth: 1,
    color: '#151435',
    fontFamily: 'Open Sans',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  rejectReasonInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  descriptionInput: {
    minHeight: 88,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  inputLabel: {
    color: '#151435',
    fontSize: 13,
    fontWeight: '600',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#006BD9',
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  saveButtonDisabled: {
    backgroundColor: '#006BD9',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  status: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  statusText: {
    color: '#151435',
  },
  error: {
    color: '#151435',
    fontSize: 13,
  },
  success: {
    color: '#006BD9',
    fontSize: 13,
  },
  empty: {
    color: '#151435',
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
    backgroundColor: '#F8F0E4',
    borderColor: '#006BD9',
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
    backgroundColor: '#006BD9',
    borderColor: '#006BD9',
  },
  navigationText: {
    color: '#151435',
    fontWeight: '600',
    textAlign: 'center',
  },
  navigationTextActive: {
    color: '#FFFFFF',
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingBottom: 24,
  },
  overviewCard: {
    backgroundColor: '#F8F0E4',
    borderColor: '#006BD9',
    borderRadius: 10,
    borderWidth: 1,
    flexBasis: 220,
    flexGrow: 1,
    gap: 6,
    padding: 18,
  },
  overviewCount: {
    color: '#006BD9',
    fontSize: 25,
    fontWeight: '700',
  },
  overviewLabel: {
    color: '#0f0d35',
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
    color: '#151435',
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
    backgroundColor: '#F8F0E4',
    borderColor: '#006BD9',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  readingTabActive: {
    backgroundColor: '#006BD9',
    borderColor: '#006BD9',
  },
  readingTabText: {
    color: '#151435',
    fontWeight: '600',
  },
  readingTabTextActive: {
    color: '#FFFFFF',
  },
  bulkToolbar: {
    alignItems: 'center',
    backgroundColor: '#F8F0E4',
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
    color: '#151435',
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
    color: '#006BD9',
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
    backgroundColor: '#D14200',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  rejectButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#006BD9',
    borderRadius: 8,
    borderWidth: 1,
    color: '#151435',
    fontFamily: 'Open Sans',
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
    backgroundColor: '#006BD9',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  clearSearchButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
  },
  clearSearchText: {
    color: '#006BD9',
    fontWeight: '600',
  },
  inspectorPasswordItem: {
    gap: 8,
  },
  passwordEditor: {
    backgroundColor: '#F8F0E4',
    borderColor: '#006BD9',
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
    color: '#151435',
    fontSize: 20,
  },
  cardSelected: {
    borderColor: '#D6FF00',
    borderWidth: 2,
  },
  deactivationActions: {
    backgroundColor: '#FFFFFF',
    borderColor: '#006BD9',
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
    backgroundColor: '#FFFFFF',
    borderColor: '#006BD9',
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
    backgroundColor: 'rgba(21,20,53,0.52)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  detailModal: {
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#F8F0E4',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  modalCloseText: {
    color: '#151435',
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
    backgroundColor: '#FFFFFF',
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
    borderTopColor: '#006BD9',
    borderTopWidth: 1,
    gap: 3,
    marginTop: 2,
    paddingTop: 5,
    paddingBottom: 2,
  },
  adminFooterAccent: {
    backgroundColor: '#006BD9',
    borderRadius: 2,
    height: 2,
    width: 32,
  },
  adminFooterText: {
    color: '#151435',
    fontSize: 10,
  },
});
