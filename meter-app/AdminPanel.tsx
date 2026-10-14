import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  approveMeterReading,
  getAdminInspectors,
  getAdminPendingMeterReadings,
  setMeterInspectorPassword,
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

export default function AdminPanel({ language, onSignOut }: AdminPanelProps) {
  const t = LANG[language];
  const [inspectors, setInspectors] = useState<Awaited<ReturnType<typeof getAdminInspectors>>>([]);
  const [passwordFields, setPasswordFields] = useState<Record<string, PasswordFields>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ readerCode: string; message: string } | null>(null);
  const [pendingReadings, setPendingReadings] = useState<MeterReadingSubmission[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState('');
  const [approvingReadingId, setApprovingReadingId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState('');

  const loadPendingReadings = useCallback(async () => {
    setPendingLoading(true);
    setPendingError('');
    try {
      setPendingReadings(await getAdminPendingMeterReadings());
    } catch {
      setPendingError(t.adminReadingsLoadFailed);
    } finally {
      setPendingLoading(false);
    }
  }, [t.adminReadingsLoadFailed]);

  const loadInspectors = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setInspectors(await getAdminInspectors());
    } catch {
      setLoadError(t.adminInspectorsLoadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.adminInspectorsLoadFailed]);

  useEffect(() => {
    void loadInspectors();
  }, [loadInspectors]);

  useEffect(() => {
    void loadPendingReadings();
  }, [loadPendingReadings]);

  const approveReading = async (readingId: string) => {
    setApprovingReadingId(readingId);
    setApprovalError('');
    try {
      await approveMeterReading(readingId);
      setPendingReadings((current) => current.filter((reading) => reading.id !== readingId));
    } catch {
      setApprovalError(t.adminReadingApprovalFailed);
    } finally {
      setApprovingReadingId(null);
    }
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
      setPasswordFields((current) => ({
        ...current,
        [readerCode]: { password: '', confirmation: '' },
      }));
      setFeedback({ readerCode, message: t.adminPasswordSaved });
    } catch {
      setFeedback({ readerCode, message: t.adminPasswordSaveFailed });
    } finally {
      setSavingCode(null);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t.adminPanelTitle}</Text>
          <Text style={styles.subtitle}>{t.adminPanelDescription}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void loadInspectors();
              void loadPendingReadings();
            }}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>{t.adminRefreshList}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void onSignOut()} style={styles.signOutButton}>
            <Text style={styles.signOutText}>{t.adminSignOut}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.reviewSection}>
        <View style={styles.reviewHeading}>
          <Text style={styles.reviewTitle}>{t.adminPendingReadings}</Text>
          <Text style={styles.readerCode}>{pendingReadings.length}</Text>
        </View>
        {pendingLoading ? (
          <View style={styles.status}>
            <ActivityIndicator />
            <Text style={styles.statusText}>{t.adminLoadingReadings}</Text>
          </View>
        ) : null}
        {pendingError ? <Text accessibilityRole="alert" style={styles.error}>{pendingError}</Text> : null}
        {approvalError ? <Text accessibilityRole="alert" style={styles.error}>{approvalError}</Text> : null}
        {!pendingLoading && !pendingError && pendingReadings.length === 0
          ? <Text style={styles.empty}>{t.adminNoPendingReadings}</Text>
          : null}
        {!pendingLoading ? (
          <ScrollView nestedScrollEnabled style={styles.pendingReadingsScroll}>
            {pendingReadings.map((reading) => (
              <View key={reading.id} style={styles.readingCard}>
                <View style={styles.identity}>
                  <Text style={styles.name}>{reading.customerName}</Text>
                  <Text style={styles.readerCode}>RICODE: {reading.readerCode}</Text>
                  <Text style={styles.readerCode}>
                    {t.accountNumber}: {reading.accountNo} · {t.meter}: {reading.meterNo || '—'}
                  </Text>
                  <Text style={styles.readerCode}>
                    {t.currentBill}: ৳{Number(reading.currentBill).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                  <Text style={styles.readerCode}>{new Date(reading.createdAt).toLocaleString()}</Text>
                  <Text style={reading.hasPhoto ? styles.statusEnabled : styles.statusDisabled}>
                    {reading.hasPhoto ? t.adminReadingPhotoIncluded : t.adminReadingPhotoMissing}
                  </Text>
                </View>
                {reading.photoBase64 ? (
                  <Image
                    accessibilityLabel={`${t.meterPhotoLabel} for ${reading.customerName}`}
                    source={{ uri: `data:image/jpeg;base64,${reading.photoBase64}` }}
                    style={styles.readingPhoto}
                    resizeMode="contain"
                  />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={approvingReadingId !== null}
                  onPress={() => void approveReading(reading.id)}
                  style={[styles.saveButton, approvingReadingId !== null && styles.saveButtonDisabled]}
                >
                  <Text style={styles.saveButtonText}>
                    {approvingReadingId === reading.id ? t.adminApprovingReading : t.adminApproveReading}
                  </Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.status}>
          <ActivityIndicator />
          <Text style={styles.statusText}>{t.adminLoadingInspectors}</Text>
        </View>
      ) : null}
      {loadError ? <Text accessibilityRole="alert" style={styles.error}>{loadError}</Text> : null}

      {!loading && !loadError ? (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {inspectors.map((inspector) => {
            const fields = passwordFields[inspector.readerCode] ?? { password: '', confirmation: '' };
            const saving = savingCode === inspector.readerCode;
            const canSave =
              fields.password.length >= 12 &&
              fields.password === fields.confirmation &&
              !saving &&
              savingCode === null;

            return (
              <View key={inspector.readerCode} style={styles.card}>
                <View style={styles.identity}>
                  <Text style={styles.name}>{inspector.name || inspector.readerCode}</Text>
                  <Text style={styles.readerCode}>RICODE: {inspector.readerCode}</Text>
                  <Text style={inspector.isActive ? styles.statusEnabled : styles.statusDisabled}>
                    {!inspector.passwordConfigured
                      ? t.adminPasswordMissing
                      : inspector.isActive
                        ? t.adminPasswordReady
                        : t.adminPasswordDisabled}
                  </Text>
                </View>

                <TextInput
                  accessibilityLabel={`${t.adminPasswordInput} for ${inspector.readerCode}`}
                  autoCapitalize="none"
                  onChangeText={(value) => updatePasswordField(inspector.readerCode, 'password', value)}
                  placeholder={t.adminPasswordInput}
                  secureTextEntry
                  style={styles.passwordInput}
                  value={fields.password}
                />
                <TextInput
                  accessibilityLabel={`${t.adminConfirmPassword} for ${inspector.readerCode}`}
                  autoCapitalize="none"
                  onChangeText={(value) => updatePasswordField(inspector.readerCode, 'confirmation', value)}
                  placeholder={t.adminConfirmPassword}
                  secureTextEntry
                  style={styles.passwordInput}
                  value={fields.confirmation}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!canSave}
                  onPress={() => void savePassword(inspector.readerCode)}
                  style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
                >
                  <Text style={styles.saveButtonText}>
                    {saving ? t.adminSavingPassword : t.adminSetPassword}
                  </Text>
                </Pressable>
                {feedback?.readerCode === inspector.readerCode ? (
                  <Text
                    accessibilityRole={feedback.message === t.adminPasswordSaved ? 'text' : 'alert'}
                    style={feedback.message === t.adminPasswordSaved ? styles.success : styles.error}
                  >
                    {feedback.message}
                  </Text>
                ) : null}
              </View>
            );
          })}
          {inspectors.length === 0 ? <Text style={styles.empty}>{t.adminNoInspectors}</Text> : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f4f7fb',
    padding: 20,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 220,
    gap: 4,
  },
  title: {
    color: '#18324b',
    fontSize: 23,
    fontWeight: '700',
  },
  subtitle: {
    color: '#607488',
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
});
