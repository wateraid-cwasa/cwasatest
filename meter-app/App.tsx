import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFonts } from 'expo-font';
import {
  OpenSans_400Regular,
  OpenSans_700Bold,
} from '@expo-google-fonts/open-sans';
import {
  ApiConnectionError,
  ApiRequestError,
  clearStoredTokens,
  createServiceRequest,
  createMeterReading,
  getCompletedMeterReadings,
  getPendingMeterReadings,
  getServiceRequests,
  lookupReadingCustomer,
  lookupServiceRequestCustomer,
  loginAdmin,
  loginMeterReader,
  TokenStorageError,
  type ReadingCustomer,
  type MeterReadingSubmission,
  type ServiceRequestCustomer,
  type ServiceRequestRecord,
  type ServiceRequestStatus,
} from './api';
import AdminPanel from './AdminPanel';
import {
  clearAuthenticatedUser,
  fetchCurrentUser,
  restoreSession,
  setAuthenticatedUser,
} from './authSlice';
import type { AppDispatch, RootState } from './store';
import { useDispatch, useSelector } from 'react-redux';
import {
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { CameraCapturedPicture } from 'expo-camera';
import { LANG, Language } from './translations';
import { styles } from './styles';

type ScreenName = 'splash' | 'signin' | 'admin' | 'list' | 'completed' | 'detail' | 'camera' | 'enter' | 'review' | 'saved' | 'profile' | 'sr' | 'srnew' | 'srdone' | 'newReading';
type DetailTab = 'bill' | 'history';
type BillApprovalFilter = 'all' | 'approved' | 'approvalRequired';
type CompletedReading = {
  id: string;
  customer: string;
  account: string;
  wardNo: string | null;
  meter: string;
  current: string;
  date: string;
};

type CustomerRecord = {
  id: number | string;
  name: string;
  addr: string;
  acc: string;
  meter: string;
  amt: string;
  dueLabel: string;
  color: string;
  detailAddress?: string;
  wardNo?: string | null;
  phone?: string;
  customerType?: string;
  meterType?: string;
  area?: string;
  ward?: string;
  connectionSize?: string;
  previousReading?: string;
  previousReadingDate?: string;
  nearbyDistance?: string;
  flag?: boolean;
  status: 'blocked' | 'normal' | 'high-use' | 'zero-use';
};

function toSubmittedReadingCustomer(record: MeterReadingSubmission): CustomerRecord {
  const bill = Number(record.currentBill);
  return {
    id: record.id,
    name: record.customerName,
    addr: `${record.readerCode} · ${new Date(record.createdAt).toLocaleString()}`,
    acc: record.accountNo,
    wardNo: record.wardNo,
    meter: record.meterNo || '—',
    amt: `৳${bill.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    dueLabel: 'Submitted',
    color: '#B7791F',
    detailAddress: undefined,
    status: 'normal',
  };
}

function toCompletedReading(record: MeterReadingSubmission): CompletedReading {
  return {
    id: record.id,
    customer: record.customerName,
    account: record.accountNo,
    wardNo: record.wardNo,
    meter: record.meterNo || '—',
    current: `৳${Number(record.currentBill).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    date: new Date(record.createdAt).toLocaleString(),
  };
}

const SERVICE_PROBLEMS = ['Meter defective', 'Meter stopped', 'Glass broken', 'Other'];
const SERVICE_REQUEST_FILTERS = ['all', 'Pending', 'In progress', 'Completed'] as const;
const NO_WARD_FILTER = '__no_ward__';

const isWeb = Platform.OS === 'web';

export default function App() {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const dispatch = useDispatch<AppDispatch>();
  const authUser = useSelector((state: RootState) => state.auth.user);
  const profileStatus = useSelector((state: RootState) => state.auth.profileStatus);
  const profileError = useSelector((state: RootState) => state.auth.profileError);
  const [screen, setScreen] = useState<ScreenName>('splash');
  const [webSidebarCollapsed, setWebSidebarCollapsed] = useState(viewportWidth <= 768);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [language, setLanguage] = useState<Language>('en');
  const [meterReaderId, setMeterReaderId] = useState('');
  const [adminSignInMode, setAdminSignInMode] = useState(false);
  const [signInPassword, setSignInPassword] = useState('');
  const [signInPasswordVisible, setSignInPasswordVisible] = useState(false);
  const [signInMessage, setSignInMessage] = useState('');
  const [signInLoading, setSignInLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('bill');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord>({
    id: '',
    name: '',
    addr: '',
    acc: '',
    meter: '',
    amt: '',
    dueLabel: '',
    color: '#B7791F',
    status: 'normal',
  });
  const [assignedCustomers, setAssignedCustomers] = useState<CustomerRecord[]>([]);
  const [assignedCustomersLoading, setAssignedCustomersLoading] = useState(false);
  const [assignedCustomersError, setAssignedCustomersError] = useState('');
  const [assignedCustomersRefreshKey, setAssignedCustomersRefreshKey] = useState(0);
  const [completedReadings, setCompletedReadings] = useState<CompletedReading[]>([]);
  const [completedReadingsLoading, setCompletedReadingsLoading] = useState(false);
  const [completedReadingsError, setCompletedReadingsError] = useState('');
  const [readingDashboardTab, setReadingDashboardTab] = useState<'pending' | 'completed'>('pending');
  const [searchText, setSearchText] = useState('');
  const [readingFilterOpen, setReadingFilterOpen] = useState(false);
  const [wardOptionOpen, setWardOptionOpen] = useState(false);
  const [draftWardFilter, setDraftWardFilter] = useState('all');
  const [wardFilter, setWardFilter] = useState('all');
  const [draftBillApprovalFilter, setDraftBillApprovalFilter] = useState<BillApprovalFilter>('all');
  const [billApprovalFilter, setBillApprovalFilter] = useState<BillApprovalFilter>('all');
  const [serviceMenuOpen, setServiceMenuOpen] = useState(false);
  const [problemMenuOpen, setProblemMenuOpen] = useState(false);
  const [serviceProblem, setServiceProblem] = useState(SERVICE_PROBLEMS[0]);
  const [serviceDescription, setServiceDescription] = useState('');
  const [serviceAccount, setServiceAccount] = useState('');
  const [reading, setReading] = useState('4377.00');
  const [readingRemarks, setReadingRemarks] = useState('');
  const [meterCondition, setMeterCondition] = useState<'normal' | 'damaged' | 'stopped'>('normal');
  const [readingConfirmed, setReadingConfirmed] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(Platform.OS === 'web' ? null : true);
  const [cameraPhoto, setCameraPhoto] = useState<CameraCapturedPicture | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');
  const [cameraTarget, setCameraTarget] = useState<'reading' | 'newReading' | 'service'>('reading');
  const [servicePhoto, setServicePhoto] = useState<CameraCapturedPicture | null>(null);
  const [serviceCustomer, setServiceCustomer] = useState<ServiceRequestCustomer | null>(null);
  const [serviceCustomerLoading, setServiceCustomerLoading] = useState(false);
  const [serviceCustomerError, setServiceCustomerError] = useState('');
  const [serviceRequests, setServiceRequests] = useState<ServiceRequestRecord[]>([]);
  const [serviceRequestsLoading, setServiceRequestsLoading] = useState(false);
  const [serviceRequestsError, setServiceRequestsError] = useState('');
  const [serviceRequestsRefreshKey, setServiceRequestsRefreshKey] = useState(0);
  const [serviceRequestFilter, setServiceRequestFilter] = useState<'all' | ServiceRequestStatus>('all');
  const [draftServiceRequestFilter, setDraftServiceRequestFilter] = useState<'all' | ServiceRequestStatus>('all');
  const [serviceRequestFilterOpen, setServiceRequestFilterOpen] = useState(false);
  const [serviceRequestSubmitting, setServiceRequestSubmitting] = useState(false);
  const [serviceRequestError, setServiceRequestError] = useState('');
  const [createdServiceRequest, setCreatedServiceRequest] = useState<ServiceRequestRecord | null>(null);
  const [newReadingForm, setNewReadingForm] = useState({
    meterOrAccount: '',
    customerName: '',
    mod: '',
    previousBill: '',
    currentBill: '',
    latitude: '',
    longitude: '',
  });
  const [newReadingCustomer, setNewReadingCustomer] = useState<ReadingCustomer | null>(null);
  const [newReadingLookupError, setNewReadingLookupError] = useState('');
  const [newReadingAutoFetching, setNewReadingAutoFetching] = useState(false);
  const [newReadingPhoto, setNewReadingPhoto] = useState<CameraCapturedPicture | null>(null);
  const [newReadingLocationLoading, setNewReadingLocationLoading] = useState(false);
  const [newReadingLocationSuccess, setNewReadingLocationSuccess] = useState(false);
  const [newReadingLocationError, setNewReadingLocationError] = useState('');
  const [newReadingSaving, setNewReadingSaving] = useState(false);
  const [newReadingErrorMsg, setNewReadingErrorMsg] = useState('');
  const [newReadingSuccessMsg, setNewReadingSuccessMsg] = useState('');
  const newReadingLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newReadingLookupSequence = useRef(0);
  const isCompactWeb = isWeb && viewportWidth <= 640;
  const isShortScreen = viewportHeight <= 700;

  useEffect(() => {
    setWebSidebarCollapsed(viewportWidth <= 768);
  }, [viewportWidth]);

  const [fontsLoaded] = useFonts({
    'Open Sans': OpenSans_400Regular,
    'Open Sans Bold': OpenSans_700Bold,
    RBNylo: require('./assets/fonts/RBNylo-Bold.otf'),
  });

  const translations = useMemo(() => LANG[language], [language]);
  const authDisplayName = authUser?.name || authUser?.readerCode || translations.profileNameUnavailable;
  const authAvatarInitial = authDisplayName.charAt(0).toUpperCase() || 'M';
  const authAccountMeta = [authUser?.readerCode, authUser?.role].filter(Boolean).join(' · ');

  useEffect(() => {
    let active = true;
    dispatch(restoreSession())
      .unwrap()
      .then((user) => {
        if (!active) return;
        if (user) {
          setScreen(user.role === 'admin' ? 'admin' : 'list');
          void dispatch(fetchCurrentUser());
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('Unable to restore the saved session:', error);
      });

    return () => {
      active = false;
    };
  }, [dispatch]);

  useEffect(() => {
    if (screen !== 'camera' || !cameraPermission?.granted) return undefined;
    let cancelled = false;

    // CameraView.isAvailableAsync() is only implemented for Web in expo-camera.
    // On native platforms (Android and iOS), it throws an UnavailabilityError.
    if (Platform.OS !== 'web') {
      setCameraAvailable(true);
      return undefined;
    }

    CameraView.isAvailableAsync()
      .then((available) => {
        if (!cancelled) setCameraAvailable(available);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCameraAvailable(false);
          setCameraError(error instanceof Error ? error.message : translations.cameraNotAvailable);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cameraPermission?.granted, screen, translations.cameraNotAvailable]);

  useEffect(() => {
    if (screen !== 'list' || authUser?.role !== 'meter_inspector') return undefined;
    let active = true;
    setAssignedCustomersLoading(true);
    setAssignedCustomersError('');
    getPendingMeterReadings()
      .then((records) => {
        if (!active) return;
        const customers = records.map(toSubmittedReadingCustomer);
        setAssignedCustomers(customers);
        if (customers.length > 0) {
          setSelectedCustomer((current) =>
            customers.find((customer) => customer.acc === current.acc) ?? customers[0],
          );
        }
      })
      .catch(() => {
        if (!active) return;
        setAssignedCustomers([]);
        setAssignedCustomersError('');
      })
      .finally(() => {
        if (active) setAssignedCustomersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assignedCustomersRefreshKey, authUser?.readerCode, authUser?.role, readingDashboardTab, screen]);

  useEffect(() => {
    const showingDashboardCompletedTab = isWeb && screen === 'list' && readingDashboardTab === 'completed';
    if ((screen !== 'completed' && !showingDashboardCompletedTab) || authUser?.role !== 'meter_inspector') return undefined;
    let active = true;
    setCompletedReadingsLoading(true);
    setCompletedReadingsError('');
    getCompletedMeterReadings()
      .then((records) => {
        if (active) setCompletedReadings(records.map(toCompletedReading));
      })
      .catch(() => {
        if (active) {
          setCompletedReadings([]);
          setCompletedReadingsError('');
        }
      })
      .finally(() => {
        if (active) setCompletedReadingsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assignedCustomersRefreshKey, authUser?.readerCode, authUser?.role, readingDashboardTab, screen]);

  useEffect(() => {
    if (screen !== 'sr' || authUser?.role !== 'meter_inspector') return undefined;
    let active = true;
    setServiceRequestsLoading(true);
    setServiceRequestsError('');
    getServiceRequests()
      .then((requests) => {
        if (active) setServiceRequests(requests);
      })
      .catch(() => {
        if (!active) return;
        setServiceRequests([]);
        setServiceRequestsError('');
      })
      .finally(() => {
        if (active) setServiceRequestsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authUser?.role, screen, serviceRequestsRefreshKey, translations.serviceRequestLoadFailed]);

  const filteredCustomers = useMemo(() => {
    const term = searchText.trim().toLowerCase();
    return assignedCustomers.filter((customer) => {
      const matchesApproval = billApprovalFilter !== 'approved';
      if (!matchesApproval) return false;
      const matchesWard = wardFilter === 'all'
        || (wardFilter === NO_WARD_FILTER ? !customer.wardNo : customer.wardNo === wardFilter);
      if (!matchesWard) return false;
      if (!term) return true;
      return [
        customer.name,
        customer.addr,
        customer.acc,
        customer.meter,
        customer.wardNo ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [assignedCustomers, billApprovalFilter, searchText, wardFilter]);

  const filteredCompletedReadings = useMemo(() => {
    const term = searchText.trim().toLowerCase();
    return completedReadings.filter((record) => {
      const matchesApproval = billApprovalFilter !== 'approvalRequired';
      if (!matchesApproval) return false;
      const matchesWard = wardFilter === 'all'
        || (wardFilter === NO_WARD_FILTER ? !record.wardNo : record.wardNo === wardFilter);
      if (!matchesWard) return false;
      if (!term) return true;
      return [record.customer, record.account, record.meter, record.current, record.date, record.wardNo ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [billApprovalFilter, completedReadings, searchText, wardFilter]);

  const availableWardNumbers = useMemo(() => {
    const wardNumbers = new Set<string>();
    for (const wardNo of [
      ...assignedCustomers.map((customer) => customer.wardNo),
      ...completedReadings.map((record) => record.wardNo),
    ]) {
      if (wardNo?.trim()) wardNumbers.add(wardNo.trim());
    }
    return Array.from(wardNumbers).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }, [assignedCustomers, completedReadings]);

  const getWardFilterLabel = (value: string) => {
    if (value === 'all') return translations.allWards;
    if (value === NO_WARD_FILTER) return translations.wardNotAvailable;
    return `${translations.ward} ${value}`;
  };
  const activeReadingFilterCount = Number(wardFilter !== 'all') + Number(billApprovalFilter !== 'all');

  const getBillApprovalFilterLabel = (value: BillApprovalFilter) => {
    if (value === 'approved') return translations.approvedBills;
    if (value === 'approvalRequired') return translations.approvalRequired;
    return translations.allBills;
  };

  const getReadingEmptyMessage = (recordCount: number, emptyMessage: string) =>
    recordCount === 0 && wardFilter === 'all' && billApprovalFilter === 'all' && !searchText.trim()
      ? emptyMessage
      : translations.noFilteredResults;

  const renderReadingFilterPanel = () => (
    <Modal
      animationType="fade"
      onRequestClose={() => {
        setReadingFilterOpen(false);
        setWardOptionOpen(false);
      }}
      transparent
      visible={readingFilterOpen}
    >
      <View style={styles.filterModalOverlay}>
        <Pressable
          accessibilityLabel={translations.closeFilter}
          accessibilityRole="button"
          onPress={() => {
            setReadingFilterOpen(false);
            setWardOptionOpen(false);
          }}
          style={styles.filterModalScrim}
        />
        <View style={[styles.filterModalCard, isWeb && styles.filterModalCardWeb]}>
          <View style={styles.filterModalHeader}>
            <View style={styles.filterModalTitleRow}>
              <Text style={styles.filterModalTitle}>{translations.filter}</Text>
            </View>
            <Pressable
              accessibilityLabel={translations.closeFilter}
              accessibilityRole="button"
              onPress={() => {
                setReadingFilterOpen(false);
                setWardOptionOpen(false);
              }}
              style={styles.filterModalClose}
            >
              <Text style={styles.filterModalCloseText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>{translations.billApprovalType}</Text>
            <View style={styles.filterOptionsList}>
              {(['all', 'approved', 'approvalRequired'] as const).map((option) => {
                const selected = draftBillApprovalFilter === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setDraftBillApprovalFilter(option)}
                    style={[styles.filterOptionItem, selected && styles.filterOptionItemActive]}
                  >
                    <View style={styles.filterOptionLeft}>
                      <View style={[styles.filterRadioCircle, selected && styles.filterRadioCircleActive]}>
                        {selected ? <View style={styles.filterRadioDot} /> : null}
                      </View>
                      <Text style={[styles.filterOptionLabel, selected && styles.filterOptionLabelActive]}>
                        {getBillApprovalFilterLabel(option)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>{translations.wardNumber}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: wardOptionOpen }}
              onPress={() => setWardOptionOpen((open) => !open)}
              style={styles.problemSelect}
            >
              <Text style={styles.problemSelectText}>{getWardFilterLabel(draftWardFilter)}</Text>
              <Text style={styles.problemSelectText}>{wardOptionOpen ? '▴' : '▾'}</Text>
            </Pressable>
            {wardOptionOpen ? (
              <ScrollView style={styles.readingFilterOptions} nestedScrollEnabled>
                {[
                  { value: 'all', label: translations.allWards },
                  ...availableWardNumbers.map((wardNo) => ({ value: wardNo, label: `${translations.ward} ${wardNo}` })),
                  ...([...assignedCustomers, ...completedReadings].some((record) => !record.wardNo)
                    ? [{ value: NO_WARD_FILTER, label: translations.wardNotAvailable }]
                    : []),
                ].map((option) => (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: draftWardFilter === option.value }}
                    onPress={() => {
                      setDraftWardFilter(option.value);
                      setWardOptionOpen(false);
                    }}
                    style={styles.problemOption}
                  >
                    <Text style={styles.problemOptionText}>{option.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>

          <View style={styles.filterModalFooter}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDraftWardFilter('all');
                setDraftBillApprovalFilter('all');
                setWardOptionOpen(false);
              }}
              style={styles.filterResetButton}
            >
              <Text style={styles.filterResetButtonText}>{translations.reset}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setWardFilter(draftWardFilter);
                setBillApprovalFilter(draftBillApprovalFilter);
                setReadingFilterOpen(false);
                setWardOptionOpen(false);
              }}
              style={styles.filterApplyButton}
            >
              <Text style={styles.filterApplyButtonText}>{translations.apply}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
  const currentReadingValue = Number(reading);
  const previousReadingValue = Number(
    selectedCustomer.previousReading?.replace(/,/g, '')
    || '0',
  );
  const readingIsValid = reading.trim() !== '' && Number.isFinite(currentReadingValue) && currentReadingValue >= previousReadingValue;
  const cycleUsage = readingIsValid ? currentReadingValue - previousReadingValue : 0;
  const isHighReading = readingIsValid && cycleUsage >= 100;
  const isZeroReading = readingIsValid && cycleUsage === 0;
  const canReviewReading = readingIsValid
    && (!isHighReading && !isZeroReading || readingConfirmed)
    && (!isHighReading || readingRemarks.trim().length > 0);

  const beginReading = async () => {
    setCameraTarget('reading');
    setReading((previousReadingValue + 82).toFixed(2));
    setReadingRemarks('');
    setReadingConfirmed(false);
    setMeterCondition('normal');
    setCameraPhoto(null);
    setCameraError('');
    setCameraReady(false);
    setCameraAvailable(Platform.OS === 'web' ? null : true);
    setScreen('camera');
    if (!cameraPermission?.granted && cameraPermission?.canAskAgain !== false) {
      try {
        await requestCameraPermission();
      } catch {
        // User can manually grant permission via Allow button
      }
    }
  };

  const allowCamera = async () => {
    setCameraError('');
    try {
      const response = await requestCameraPermission();
      if (response && !response.granted) {
        setCameraError(translations.cameraPermissionDenied);
      } else if (response?.granted && Platform.OS !== 'web') {
        setCameraAvailable(true);
      }
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : translations.cameraPermissionDenied);
    }
  };

  const compressNewReadingPhoto = async (
    uri: string,
    width: number,
    height: number,
  ): Promise<CameraCapturedPicture> => {
    for (const maxEdge of [1280, 1024, 800, 640]) {
      const resizeTo = Math.min(maxEdge, Math.max(width, height));
      const dimensions = width >= height ? { width: resizeTo } : { height: resizeTo };
      for (const quality of [0.65, 0.5, 0.35]) {
        const compressed = await ImageManipulator.manipulate(uri)
          .resize(dimensions)
          .renderAsync()
          .then((image) => image.saveAsync({
            base64: true,
            compress: quality,
            format: SaveFormat.JPEG,
          }));
        if (!compressed.base64) {
          throw new Error('Image compression did not produce image data.');
        }
        if (compressed.base64.length * 0.75 <= 900_000) {
          return {
            uri: compressed.uri,
            width: compressed.width,
            height: compressed.height,
            format: 'jpg',
            base64: compressed.base64,
          };
        }
      }
    }
    throw new Error('The meter photo could not be reduced below the 1 MB upload limit.');
  };

  const chooseNewReadingPhotoFromGallery = async () => {
    setNewReadingErrorMsg('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) {
        throw new Error('The selected image could not be read.');
      }
      setNewReadingPhoto(await compressNewReadingPhoto(asset.uri, asset.width, asset.height));
    } catch (error) {
      setNewReadingErrorMsg(
        error instanceof Error
          ? `Could not load or resize the selected meter photo. ${error.message}`
          : 'Could not load or resize the selected meter photo.',
      );
    }
  };

  const captureMeterPhoto = async () => {
    if (!cameraReady || !cameraRef.current) return;
    setCameraError('');
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo) {
        setCameraError(translations.cameraCaptureError);
        return;
      }
      if (cameraTarget === 'newReading') {
        setNewReadingPhoto(await compressNewReadingPhoto(photo.uri, photo.width, photo.height));
      } else if (cameraTarget === 'service') {
        setServicePhoto(photo);
      } else {
        setCameraPhoto(photo);
      }
    } catch (error) {
      setCameraError(error instanceof Error ? `${translations.cameraCaptureError} ${error.message}` : translations.cameraCaptureError);
    }
  };

  const retakeMeterPhoto = () => {
    if (cameraTarget === 'newReading') {
      setNewReadingPhoto(null);
    } else if (cameraTarget === 'service') {
      setServicePhoto(null);
    } else {
      setCameraPhoto(null);
    }
    setCameraError('');
    setCameraReady(false);
  };

  const submitSignIn = async () => {
    if (signInLoading) return;
    if (!meterReaderId.trim() || !signInPassword) {
      setSignInMessage(translations.completeAllFields);
      return;
    }

    setSignInLoading(true);
    setSignInMessage('');
    try {
      const user = adminSignInMode
        ? await loginAdmin({ username: meterReaderId.trim(), password: signInPassword })
        : await loginMeterReader({
            meterReaderId: meterReaderId.trim(),
            password: signInPassword,
          });
      dispatch(setAuthenticatedUser(user));
      setScreen(user.role === 'admin' ? 'admin' : 'list');
      void dispatch(fetchCurrentUser());
    } catch (error) {
      setSignInMessage(
        error instanceof TokenStorageError
          ? translations.loginStorageError
          : error instanceof ApiConnectionError
            ? translations.loginConnectionFailed
          : error instanceof ApiRequestError
            ? `${translations.loginFailed} (HTTP ${error.status})`
            : translations.loginFailed,
      );
    } finally {
      setSignInLoading(false);
    }
  };

  const handleMeterOrAccountChange = (val: string) => {
    const identifier = val.trim();
    const requestSequence = ++newReadingLookupSequence.current;
    if (newReadingLookupTimer.current) {
      clearTimeout(newReadingLookupTimer.current);
      newReadingLookupTimer.current = null;
    }
    setNewReadingCustomer(null);
    setNewReadingPhoto(null);
    setNewReadingLookupError('');
    setNewReadingSuccessMsg('');
    setNewReadingErrorMsg('');
    setNewReadingForm((previous) => ({
      ...previous,
      meterOrAccount: val,
      customerName: '',
      mod: '',
      previousBill: '',
      currentBill: '',
    }));
    if (!identifier) {
      setNewReadingAutoFetching(false);
      return;
    }

    setNewReadingAutoFetching(true);
    newReadingLookupTimer.current = setTimeout(() => {
      void lookupReadingCustomer(identifier)
        .then((customer) => {
          if (newReadingLookupSequence.current !== requestSequence) return;
          setNewReadingCustomer(customer);
          setNewReadingForm((previous) => ({
            ...previous,
            customerName: customer.customerName,
            mod: customer.wardNo ? `Ward ${customer.wardNo}` : '',
            previousBill: customer.previousBill
              ? `৳${Number(customer.previousBill).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              : '',
          }));
        })
        .catch((error: unknown) => {
          if (newReadingLookupSequence.current !== requestSequence) return;
          setNewReadingLookupError(
            error instanceof ApiRequestError && error.status === 404
              ? 'No customer was found for that meter or account number.'
              : 'Could not look up the customer. Check the API and source database, then retry.',
          );
        })
        .finally(() => {
          if (newReadingLookupSequence.current === requestSequence) {
            setNewReadingAutoFetching(false);
            newReadingLookupTimer.current = null;
          }
        });
    }, 450);
  };

  const fetchDeviceLocation = async () => {
    setNewReadingLocationLoading(true);
    setNewReadingLocationSuccess(false);
    setNewReadingLocationError('');
    setNewReadingErrorMsg('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error('Allow location access in your device or browser settings.');
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setNewReadingForm((previous) => ({
        ...previous,
        latitude: position.coords.latitude.toFixed(6),
        longitude: position.coords.longitude.toFixed(6),
      }));
      setNewReadingLocationSuccess(true);
    } catch (error) {
      setNewReadingLocationError(
        error instanceof Error
          ? error.message
          : 'Could not read device location. Check location permission and retry.',
      );
    } finally {
      setNewReadingLocationLoading(false);
    }
  };

  useEffect(() => {
    if (screen === 'newReading' && !newReadingForm.latitude) {
      fetchDeviceLocation();
    }
  }, [screen]);

  const openNewReadingCamera = async () => {
    setCameraTarget('newReading');
    setCameraError('');
    setCameraReady(false);
    setCameraAvailable(Platform.OS === 'web' ? null : true);
    setScreen('camera');
    if (!cameraPermission?.granted && cameraPermission?.canAskAgain !== false) {
      try {
        await requestCameraPermission();
      } catch {
        // Fallback handled in allowCamera
      }
    }
  };

  const openServiceCamera = async () => {
    setCameraTarget('service');
    setCameraError('');
    setCameraReady(false);
    setCameraAvailable(Platform.OS === 'web' ? null : true);
    setScreen('camera');
    if (!cameraPermission?.granted && cameraPermission?.canAskAgain !== false) {
      try {
        await requestCameraPermission();
      } catch {
        // Fallback handled in allowCamera
      }
    }
  };

  const pickServiceImageFromGallery = () => {
    if (typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (target.files && target.files[0]) {
          const file = target.files[0];
          const url = URL.createObjectURL(file);
          setServicePhoto({
            uri: url,
            width: 800,
            height: 600,
            format: 'jpg',
          });
        }
      };
      input.click();
    }
  };

  const resetNewReadingForm = () => {
    newReadingLookupSequence.current += 1;
    if (newReadingLookupTimer.current) {
      clearTimeout(newReadingLookupTimer.current);
      newReadingLookupTimer.current = null;
    }
    setNewReadingForm({
      meterOrAccount: '',
      customerName: '',
      mod: '',
      previousBill: '',
      currentBill: '',
      latitude: '',
      longitude: '',
    });
    setNewReadingCustomer(null);
    setNewReadingLookupError('');
    setNewReadingPhoto(null);
    setNewReadingLocationLoading(false);
    setNewReadingLocationSuccess(false);
    setNewReadingLocationError('');
    setNewReadingSaving(false);
    setNewReadingErrorMsg('');
    setNewReadingSuccessMsg('');
  };

  const openNewReadingForSelectedCustomer = () => {
    resetNewReadingForm();
    handleMeterOrAccountChange(selectedCustomer.acc);
    setScreen('newReading');
  };

  const submitNewReadingForm = async () => {
    if (newReadingLookupTimer.current) {
      clearTimeout(newReadingLookupTimer.current);
      newReadingLookupTimer.current = null;
    }
    newReadingLookupSequence.current += 1;
    setNewReadingErrorMsg('');
    setNewReadingSuccessMsg('');
    const identifier = newReadingForm.meterOrAccount.trim();
    const currentBill = newReadingForm.currentBill.trim();
    if (!identifier || !currentBill) {
      setNewReadingErrorMsg('Enter a meter or account number and current bill.');
      return;
    }
    if (!newReadingPhoto?.base64) {
      setNewReadingErrorMsg(translations.meterPhotoRequired);
      return;
    }
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(currentBill)) {
      setNewReadingErrorMsg('Enter a valid non-negative bill amount with up to 2 decimal places.');
      return;
    }
    if (!newReadingForm.latitude || !newReadingForm.longitude) {
      setNewReadingErrorMsg('Capture the device GPS location before submitting.');
      return;
    }

    setNewReadingSaving(true);
    try {
      const customer = newReadingCustomer?.accountNo === identifier ||
        newReadingCustomer?.meterNo?.toLowerCase() === identifier.toLowerCase()
        ? newReadingCustomer
        : await lookupReadingCustomer(identifier);
      const saved = await createMeterReading({
        identifier,
        currentBill,
        latitude: Number(newReadingForm.latitude),
        longitude: Number(newReadingForm.longitude),
        photoBase64: newReadingPhoto.base64,
      });
      setNewReadingCustomer(customer);
      const successMessage = translations.readingSubmittedForReview
        .replace('{name}', saved.customerName)
        .replace('{account}', saved.accountNo);
      resetNewReadingForm();
      setAssignedCustomersRefreshKey((value) => value + 1);
      setNewReadingSuccessMsg(successMessage);
      setNewReadingErrorMsg('');
    } catch (error) {
      setNewReadingErrorMsg(
        error instanceof ApiRequestError && error.status === 404
          ? 'No customer was found for that meter or account number.'
          : error instanceof ApiRequestError && error.status === 413
            ? 'The compressed meter photo is too large. Retake the photo and retry.'
            : error instanceof ApiConnectionError
              ? 'Could not connect to the API. Check that the backend is running.'
              : 'Could not save the reading. Check the API/database setup and retry.',
      );
    } finally {
      setNewReadingSaving(false);
    }
  };

  const renderWebPageFooter = () => (
    <View style={styles.webPageFooter}>
      <View style={styles.webPageFooterDivider} />
      <View style={styles.webPageFooterRow}>
        <View style={styles.webPageFooterBrand}>
        </View>
      </View>
    </View>
  );

  const renderSplash = () => (
    <Pressable
      onPress={() => {
        setSignInMessage('');
        setScreen('signin');
      }}
      style={styles.fullScreenCard}
    >
      <Image
        source={require('./assets/cwasa-logo.png')}
        style={styles.splashLogo}
        resizeMode="contain"
      />
      <Text style={[styles.heading, styles.splashTitle]}>Meter Reading</Text>
      <Text style={[styles.banglaTitle, styles.splashBangla]}>মিটার রিডিং</Text>
      <View style={styles.waterAidRow}>
      </View>
      <Text style={styles.tapText}>{translations.tapToContinue}</Text>
    </Pressable>
  );

  const renderSignIn = () => (
    <ScrollView
      style={styles.screenShell}
      contentContainerStyle={[styles.signInContent, isWeb && styles.webAuthFooterSpace]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.topActions}>
        <Pressable
          onPress={() => setLanguage((current) => (current === 'en' ? 'bn' : 'en'))}
          style={styles.langButton}
        >
          <Text style={styles.langButtonText}>{language === 'en' ? 'বাংলা | EN' : 'EN | বাংলা'}</Text>
        </Pressable>
      </View>

      <Image
        source={require('./assets/cwasa-logo.png')}
        style={[styles.signInLogo, isShortScreen && styles.signInLogoCompact]}
        resizeMode="contain"
      />
      <Text style={[styles.heading, styles.signInHeading, isShortScreen && styles.signInHeadingCompact]}>
        {translations.signIn}
      </Text>

      <View style={[styles.fieldBlock, isShortScreen && styles.signInFieldBlockCompact]}>
        <Text style={styles.labelText}>
          {adminSignInMode ? translations.adminUsername : translations.MID}
        </Text>
        <TextInput
          value={meterReaderId}
          onChangeText={(value) => {
            setMeterReaderId(value);
            setSignInMessage('');
          }}
          autoCapitalize="none"
          style={styles.inputField}
        />
      </View>

      <View style={[styles.fieldBlock, isShortScreen && styles.signInFieldBlockCompact]}>
        <Text style={styles.labelText}>{translations.password}</Text>
        <View style={styles.passwordInputContainer}>
          <TextInput
            value={signInPassword}
            onChangeText={(value) => {
              setSignInPassword(value);
              setSignInMessage('');
            }}
            secureTextEntry={!signInPasswordVisible}
            style={[styles.inputField, styles.passwordInput]}
          />
          <Pressable
            accessibilityLabel={
              signInPasswordVisible ? translations.hidePassword : translations.showPassword
            }
            accessibilityRole="button"
            onPress={() => setSignInPasswordVisible((visible) => !visible)}
            style={styles.passwordVisibilityButton}
            hitSlop={8}
          >
            <View style={styles.passwordEye}>
              <View style={styles.passwordEyePupil} />
              {!signInPasswordVisible ? <View style={styles.passwordEyeSlash} /> : null}
            </View>
          </Pressable>
        </View>
      </View>

      {signInMessage ? (
        <Text accessibilityRole="alert" style={styles.signInMessage}>
          {signInMessage}
        </Text>
      ) : null}

      <View style={styles.flexSpacer} />

      <Pressable
        disabled={signInLoading}
        onPress={submitSignIn}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>
          {signInLoading ? translations.signingIn : translations.signIn}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={signInLoading}
        onPress={() => {
          setAdminSignInMode((current) => !current);
          setMeterReaderId('');
          setSignInPassword('');
          setSignInMessage('');
        }}
        style={{ alignItems: 'center', paddingVertical: 14 }}
      >
        <Text style={{ color: '#086f83', fontWeight: '600' }}>
          {adminSignInMode ? translations.inspectorSignIn : translations.adminSignIn}
        </Text>
      </Pressable>
      {isWeb ? renderWebPageFooter() : null}
    </ScrollView>
  );

  const openProfile = () => {
    setDrawerOpen(false);
    setScreen('profile');
  };

  const logOut = async () => {
    try {
      await clearStoredTokens();
      dispatch(clearAuthenticatedUser());
      setDrawerOpen(false);
      setSignInMessage('');
      setAdminSignInMode(false);
      setMeterReaderId('');
      setSignInPassword('');
      setScreen('splash');
    } catch (error) {
      const message = error instanceof Error ? error.message : translations.logoutFailed;
      if (Platform.OS === 'web') {
        window.alert(`${translations.logoutFailed} ${message}`);
      } else {
        Alert.alert(translations.logoutFailed, message);
      }
    }
  };

  const renderAccountDrawer = () => (
    <View style={styles.accountDrawerLayer}>
      <Pressable
        accessibilityLabel="Close side menu"
        onPress={() => setDrawerOpen(false)}
        style={styles.accountDrawerScrim}
      />
      <View style={styles.accountDrawer}>
        <View style={styles.accountDrawerHeader}>
          <View style={styles.accountAvatar}><Text style={styles.accountAvatarText}>{authAvatarInitial}</Text></View>
          <View style={styles.accountIdentity}>
            <Text style={styles.accountName}>{authDisplayName}</Text>
            <Text style={styles.accountMeta}>{authAccountMeta}</Text>
          </View>
          <Pressable
            accessibilityLabel="Close side menu"
            onPress={() => setDrawerOpen(false)}
            style={styles.accountDrawerClose}
          >
            <Text style={styles.accountDrawerCloseText}>×</Text>
          </Pressable>
        </View>
        <Pressable onPress={openProfile} style={styles.accountMenuItem}>
          <Text style={styles.accountMenuIcon}>◉</Text>
          <Text style={styles.accountMenuText}>{translations.profile}</Text>
          <Text style={styles.accountMenuChevron}>›</Text>
        </Pressable>
        <View style={styles.accountMenuDivider} />
        <View style={styles.accountLanguageRow}>
          <Text style={styles.accountMenuText}>{translations.language}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setLanguage((current) => (current === 'en' ? 'bn' : 'en'))}
            style={styles.accountLanguageButton}
          >
            <Text style={styles.accountLanguageButtonText}>{language === 'en' ? 'বাংলা | EN' : 'EN | বাংলা'}</Text>
          </Pressable>
        </View>
        <View style={styles.accountDrawerSpacer} />
        <Pressable onPress={logOut} style={styles.accountMenuItem}>
          <Text style={styles.accountMenuIconLogout}>↪</Text>
          <Text style={styles.accountMenuLogoutText}>{translations.logOut}</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderProfile = () => {
    const profileContent = (
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{authAvatarInitial}</Text></View>
        <Text style={styles.profileName}>{authDisplayName}</Text>
        <Text style={styles.profileMeta}>{authAccountMeta}</Text>
        {profileStatus === 'loading' ? (
          <Text style={styles.profileMeta}>{translations.profileLoading}</Text>
        ) : null}
        {profileError?.type === 'connection' ? (
          <Text accessibilityRole="alert" style={styles.signInMessage}>
            {translations.profileConnectionFailed}
          </Text>
        ) : null}
        {profileError?.type === 'request' ? (
          <Text accessibilityRole="alert" style={styles.signInMessage}>
            {translations.profileRequestFailed} (HTTP {profileError.status})
          </Text>
        ) : null}
        {profileError?.type === 'invalid' ? (
          <Text accessibilityRole="alert" style={styles.signInMessage}>
            {translations.profileInvalidResponse}
          </Text>
        ) : null}
        {profileError?.type === 'unexpected' ? (
          <Text accessibilityRole="alert" style={styles.signInMessage}>
            {profileError.message}
          </Text>
        ) : null}
        <View style={styles.profileFields}>
          {[
            [translations.employeeName, authUser?.name || translations.notProvided],
            [translations.meterReaderCode, authUser?.readerCode || translations.notProvided],
            [translations.meterReaderId, authUser?.meterReaderId || translations.notProvided],
            [translations.role, authUser?.role || translations.notProvided],
            [translations.userId, authUser?.id || translations.notProvided],
          ].map(([label, value]) => (
            <View key={label} style={styles.profileFieldRow}>
              <Text style={styles.profileFieldLabel}>{label}</Text>
              <Text style={styles.profileFieldValue}>{value}</Text>
            </View>
          ))}
        </View>
      </View>
    );

    if (isWeb) {
      return (
        <View style={styles.webDashboard}>
          {renderWebSidebar()}
          <View style={styles.webMain}>
            <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
              <View>
                <Text style={styles.webBreadcrumb}>ACCOUNT</Text>
                <Text style={styles.webPageTitle}>Profile</Text>
              </View>
            </View>
            <ScrollView style={styles.profileScroll} contentContainerStyle={[styles.profilePageContent, styles.webPageFooterSpace]}>
              {profileContent}
              {renderWebPageFooter()}
            </ScrollView>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.screenShellDark}>
        <View style={styles.topBar}>
          <Pressable onPress={() => setScreen('list')} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>←</Text>
          </Pressable>
          <Text style={[styles.heading, styles.topBarTitle]}>Profile</Text>
        </View>
        <ScrollView style={styles.profileScroll} contentContainerStyle={styles.profilePageContent}>
          {profileContent}
        </ScrollView>
      </View>
    );
  };

  const renderList = () => (
    <View style={styles.screenShellDark}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => {
            setDrawerOpen(true);
          }}
          accessibilityLabel="Open side menu"
          style={styles.iconButton}
        >
          <Text style={styles.iconButtonText}>☰</Text>
        </Pressable>
        <Text style={[styles.heading, styles.topBarTitle]}>{translations.meterReading}</Text>
        <View style={styles.topBarIcons}>
          <Text style={styles.iconText}>⌕</Text>
          <Text style={styles.iconText}>🔔︎</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <Pressable onPress={() => setScreen('list')} style={screen === 'list' ? styles.tabItemActive : styles.tabItemInactive}>
          <Text style={screen === 'list' ? styles.tabTextActive : styles.tabTextInactive}>{translations.pendingReadings} {assignedCustomers.length}</Text>
        </Pressable>
        <Pressable onPress={() => setScreen('completed')} style={screen === 'completed' ? styles.tabItemActive : styles.tabItemInactive}>
          <Text style={screen === 'completed' ? styles.tabTextActive : styles.tabTextInactive}>{translations.completedReadings} {completedReadings.length}</Text>
        </Pressable>
      </View>

      <View style={styles.searchArea}>
        <View style={styles.searchFieldContainer}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder={`${translations.search}: ${translations.searchPlaceholder}`}
            placeholderTextColor="#5B6275"
            style={styles.searchInput}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: readingFilterOpen }}
          onPress={() => {
            if (!readingFilterOpen) setDraftWardFilter(wardFilter);
            if (!readingFilterOpen) setDraftBillApprovalFilter(billApprovalFilter);
            setWardOptionOpen(false);
            setReadingFilterOpen((open) => !open);
          }}
          style={[styles.filterTriggerButton, wardFilter !== 'all' && styles.filterTriggerButtonActive]}
        >
          <Text style={[styles.filterTriggerText, wardFilter !== 'all' && styles.filterTriggerTextActive]}>
            {translations.filter}{activeReadingFilterCount > 0 ? ` · ${activeReadingFilterCount}` : ''}
          </Text>
        </Pressable>
      </View>
      {renderReadingFilterPanel()}

      <ScrollView style={styles.customerList} contentContainerStyle={styles.customerListContent}>
        {assignedCustomersLoading ? (
          <View style={styles.emptyFilteredBox}>
            <Text style={styles.emptyFilteredTitle}>{translations.loadingSubmittedReadings}</Text>
          </View>
        ) : assignedCustomersError ? (
          <View style={styles.emptyFilteredBox}>
            <Text accessibilityRole="alert" style={styles.emptyFilteredTitle}>{assignedCustomersError}</Text>
            <Pressable onPress={() => setAssignedCustomersRefreshKey((value) => value + 1)} style={styles.emptyFilteredResetBtn}>
              <Text style={styles.emptyFilteredResetBtnText}>{translations.retry}</Text>
            </Pressable>
          </View>
        ) : filteredCustomers.length === 0 ? (
          <View style={styles.emptyFilteredBox}>
            <Text style={styles.emptyFilteredIcon}>📋</Text>
            <Text style={styles.emptyFilteredTitle}>
              {getReadingEmptyMessage(assignedCustomers.length, translations.noPendingReadings)}
            </Text>
          </View>
        ) : (
          filteredCustomers.map((customer) => (
            <Pressable
              key={customer.id}
              onPress={() => {
                setSelectedCustomer(customer);
                setScreen('detail');
              }}
              style={styles.customerCard}
            >
              {customer.flag ? <Text style={styles.complaintBadge}>⚑ {translations.complaint}</Text> : null}
              <View style={styles.customerCardRow}>
                <View style={styles.customerDetails}>
                  <View style={styles.customerNameRow}>
                    <Text style={styles.customerName}>{customer.name}</Text>
                    <View style={styles.badgeApprovalReq}>
                      <Text style={styles.badgeApprovalReqText}>{translations.awaitingAdminReview}</Text>
                    </View>
                  </View>
                  <Text style={styles.customerAddress}>{customer.addr}</Text>
                  <Text style={styles.customerMeta}>{translations.account} {customer.acc} · {translations.meter} {customer.meter}</Text>
                  {customer.wardNo ? <Text style={styles.customerMeta}>{translations.ward} {customer.wardNo}</Text> : null}
                </View>
                <View style={styles.customerRightColumn}>
                  <Text style={[styles.customerAmount, { color: customer.color }]}>{customer.amt}</Text>
                  <Text style={styles.customerDueLabel}>{translations.pending}</Text>
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* Floating Action Button (FAB) at right bottom for New Reading */}
      <Pressable
        accessibilityLabel="Create new reading"
        accessibilityRole="button"
        onPress={() => {
          resetNewReadingForm();
          setScreen('newReading');
        }}
        style={styles.floatingActionButton}
      >
        <Text style={styles.floatingActionButtonText}>＋</Text>
      </Pressable>

      <View style={styles.bottomNav}>
        <View style={styles.bottomNavItemActive}>
          <Text style={styles.navIcon}>◉</Text>
          <Text style={styles.navLabelActive}>{translations.meterReading}</Text>
        </View>
        <Pressable onPress={() => setScreen('sr')} style={styles.bottomNavItem}>
          <Text style={styles.navIcon}>▤</Text>
          <Text style={styles.navLabel}>{translations.serviceRequest}</Text>
        </Pressable>
      </View>
    </View>
  );

  const openCreateServiceRequest = () => {
    setServiceAccount('');
    setServiceCustomer(null);
    setServiceCustomerError('');
    setServiceDescription('');
    setServiceProblem(SERVICE_PROBLEMS[0]);
    setServicePhoto(null);
    setServiceRequestError('');
    setCreatedServiceRequest(null);
    setScreen('srnew');
  };

  const findServiceRequestCustomer = async () => {
    const identifier = serviceAccount.trim();
    if (!identifier) {
      setServiceCustomerError(translations.serviceRequestCustomerNumberRequired);
      setServiceCustomer(null);
      return;
    }
    setServiceCustomerLoading(true);
    setServiceCustomerError('');
    setServiceCustomer(null);
    try {
      const customer = await lookupServiceRequestCustomer(identifier);
      setServiceCustomer(customer);
    } catch (error) {
      setServiceCustomerError(
        error instanceof ApiRequestError &&
        error.status === 404 &&
        error.responseMessage?.includes('No customer matches')
          ? translations.serviceRequestCustomerNotFound
          : error instanceof ApiRequestError && error.status === 401
            ? translations.serviceRequestAuthFailed
            : error instanceof ApiRequestError && error.status === 403
              ? translations.serviceRequestForbidden
              : error instanceof ApiRequestError
                ? translations.serviceRequestLookupHttpFailed.replace('{status}', String(error.status))
                : error instanceof ApiConnectionError
                  ? translations.serviceRequestConnectionFailed
          : translations.serviceRequestCustomerLookupFailed,
      );
    } finally {
      setServiceCustomerLoading(false);
    }
  };

  const submitServiceRequest = async () => {
    setServiceRequestError('');
    if (!serviceAccount.trim()) {
      setServiceRequestError(translations.serviceRequestNumberRequired);
      return;
    }
    if (!serviceCustomer) {
      setServiceRequestError(translations.serviceRequestCustomerRequired);
      return;
    }
    if (!serviceDescription.trim()) {
      setServiceRequestError(translations.serviceRequestDescriptionRequired);
      return;
    }

    setServiceRequestSubmitting(true);
    try {
      let photoBase64: string | undefined;
      if (servicePhoto) {
        try {
          const resizeTo = Math.min(1280, Math.max(servicePhoto.width, servicePhoto.height));
          const dimensions = servicePhoto.width >= servicePhoto.height
            ? { width: resizeTo }
            : { height: resizeTo };
          const compressed = await ImageManipulator.manipulate(servicePhoto.uri)
            .resize(dimensions)
            .renderAsync()
            .then((image) => image.saveAsync({
              base64: true,
              compress: 0.65,
              format: SaveFormat.JPEG,
            }));
          if (!compressed.base64) {
            throw new Error('Image compression did not produce image data.');
          }
          photoBase64 = compressed.base64;
        } catch {
          setServiceRequestError(translations.serviceRequestPhotoCompressionFailed);
          return;
        }
      }
      const request = await createServiceRequest({
        identifier: serviceAccount.trim(),
        problemType: serviceProblem,
        description: serviceDescription.trim(),
        ...(photoBase64 ? { photoBase64 } : {}),
      });
      setCreatedServiceRequest(request);
      setServiceRequestFilter('all');
      setScreen('srdone');
    } catch (error) {
      setServiceRequestError(
        error instanceof ApiRequestError && error.status === 404
          ? translations.serviceRequestCustomerNotFound
          : error instanceof ApiConnectionError
            ? translations.serviceRequestConnectionFailed
            : error instanceof ApiRequestError && error.status === 413
              ? translations.serviceRequestPhotoTooLarge
              : translations.serviceRequestCreateFailed,
      );
    } finally {
      setServiceRequestSubmitting(false);
    }
  };

  const filteredServiceRequests = serviceRequestFilter === 'all'
    ? serviceRequests
    : serviceRequests.filter((request) => request.status === serviceRequestFilter);

  const getServiceRequestFilterLabel = (filter: typeof SERVICE_REQUEST_FILTERS[number]) => {
    if (filter === 'all') return translations.allServiceRequests;
    if (filter === 'Pending') return translations.pendingServiceRequests;
    if (filter === 'In progress') return translations.inProgressServiceRequests;
    return translations.completedServiceRequests;
  };

  const openServiceRequestFilter = () => {
    setDraftServiceRequestFilter(serviceRequestFilter);
    setServiceRequestFilterOpen(true);
  };

  const closeServiceRequestFilter = () => setServiceRequestFilterOpen(false);

  const renderServiceRequestFilterModal = () => (
    <Modal
      animationType="fade"
      onRequestClose={closeServiceRequestFilter}
      transparent
      visible={serviceRequestFilterOpen}
    >
      <View style={styles.filterModalOverlay}>
        <Pressable
          accessibilityLabel={translations.closeFilter}
          accessibilityRole="button"
          onPress={closeServiceRequestFilter}
          style={styles.filterModalScrim}
        />
        <View style={[styles.filterModalCard, isWeb && styles.filterModalCardWeb]}>
          <View style={styles.filterModalHeader}>
            <Text style={styles.filterModalTitle}>{translations.filter}</Text>
            <Pressable
              accessibilityLabel={translations.closeFilter}
              accessibilityRole="button"
              onPress={closeServiceRequestFilter}
              style={styles.filterModalClose}
            >
              <Text style={styles.filterModalCloseText}>×</Text>
            </Pressable>
          </View>
          <View style={styles.filterOptionsList}>
            {SERVICE_REQUEST_FILTERS.map((filter) => {
              const selected = draftServiceRequestFilter === filter;
              return (
                <Pressable
                  key={filter}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setDraftServiceRequestFilter(filter)}
                  style={[styles.filterOptionItem, selected && styles.filterOptionItemActive]}
                >
                  <View style={styles.filterOptionLeft}>
                    <View style={[styles.filterRadioCircle, selected && styles.filterRadioCircleActive]}>
                      {selected ? <View style={styles.filterRadioDot} /> : null}
                    </View>
                    <Text style={[styles.filterOptionLabel, selected && styles.filterOptionLabelActive]}>
                      {getServiceRequestFilterLabel(filter)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.filterModalFooter}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDraftServiceRequestFilter('all');
                setServiceRequestFilter('all');
              }}
              style={styles.filterResetButton}
            >
              <Text style={styles.filterResetButtonText}>{translations.reset}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setServiceRequestFilter(draftServiceRequestFilter);
                closeServiceRequestFilter();
              }}
              style={styles.filterApplyButton}
            >
              <Text style={styles.filterApplyButtonText}>{translations.apply}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  const getServiceRequestStatusLabel = (status: ServiceRequestStatus) => {
    if (status === 'Pending') return translations.serviceStatusPending;
    if (status === 'In progress') return translations.serviceStatusInProgress;
    return translations.serviceStatusCompleted;
  };

  const getServiceProblemLabel = (problem: string) => {
    if (problem === 'Meter defective') return translations.serviceProblemMeterDefective;
    if (problem === 'Meter stopped') return translations.serviceProblemMeterStopped;
    if (problem === 'Glass broken') return translations.serviceProblemGlassBroken;
    return translations.serviceProblemOther;
  };

  const renderServiceRequestsEmptyState = () => (
    <View style={styles.serviceRequestEmptyState}>
      <Text style={styles.serviceRequestEmptyIcon}>▤</Text>
      <Text style={styles.serviceRequestEmptyText}>{translations.noServiceRequests}</Text>
    </View>
  );

  const renderServiceRequestList = () => (
    <View style={styles.screenShellDark}>
      <View style={styles.topBar}>
        <Pressable onPress={() => setScreen('list')} style={styles.iconButton}>
          <Text style={styles.iconButtonText}>←</Text>
        </Pressable>
        <Text style={[styles.heading, styles.topBarTitle]}>{translations.serviceRequest}</Text>
      </View>
      {renderServiceRequestFilterModal()}
      <View style={styles.fieldBlock}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: serviceRequestFilterOpen }}
          onPress={openServiceRequestFilter}
          style={[styles.filterTriggerButton, serviceRequestFilter !== 'all' && styles.filterTriggerButtonActive]}
        >
          <Text style={[styles.filterTriggerText, serviceRequestFilter !== 'all' && styles.filterTriggerTextActive]}>
            {translations.filter}{serviceRequestFilter !== 'all' ? ' · 1' : ''}
          </Text>
        </Pressable>
      </View>
      <ScrollView style={styles.customerList} contentContainerStyle={styles.customerListContent}>
        {serviceRequestsLoading ? (
          <Text style={styles.customerAddress}>{translations.serviceRequestLoading}</Text>
        ) : serviceRequestsError ? (
          <View style={styles.emptyFilteredBox}>
            <Text accessibilityRole="alert" style={styles.emptyFilteredTitle}>{serviceRequestsError}</Text>
            <Pressable onPress={() => setServiceRequestsRefreshKey((key) => key + 1)} style={styles.emptyFilteredResetBtn}>
              <Text style={styles.emptyFilteredResetBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : filteredServiceRequests.length === 0 ? (
          renderServiceRequestsEmptyState()
        ) : filteredServiceRequests.map((request) => (
          <View key={request.id} style={styles.customerCard}>
            <Text style={styles.customerName}>{request.customerName}</Text>
            <Text style={styles.customerAddress}>{request.accountNo}{request.meterNo ? ` · ${request.meterNo}` : ''}</Text>
            <Text style={styles.serviceProblemText}>⚠ {getServiceProblemLabel(request.problemType)}</Text>
            <Text style={styles.customerAddress}>{request.description}</Text>
            <Text style={styles.servicePendingBadge}>{getServiceRequestStatusLabel(request.status)}</Text>
            <Text style={styles.customerAddress}>
              {new Date(request.createdAt).toLocaleString(translations.serviceRequestDateLocale)}
            </Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.serviceRequestFooter}>
        <Pressable onPress={() => setScreen('list')} style={styles.secondaryFooterButton}>
          <Text style={styles.secondaryFooterText}>{translations.meterReading}</Text>
        </Pressable>
        <Pressable onPress={openCreateServiceRequest} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>＋  {translations.createServiceRequest}</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderCreateServiceRequest = () => (
    <View style={styles.screenShellDark}>
      <View style={styles.topBar}>
        <Pressable onPress={() => setScreen('sr')} style={styles.iconButton}>
          <Text style={styles.iconButtonText}>←</Text>
        </Pressable>
        <Text style={[styles.heading, styles.topBarTitle]}>{translations.createServiceRequest}</Text>
      </View>
      <ScrollView style={styles.serviceFormScroll} contentContainerStyle={styles.serviceFormContent}>
        <View style={styles.fieldBlock}>
          <Text style={styles.labelText}>{translations.serviceRequestCustomerNumber} *</Text>
          <TextInput
            value={serviceAccount}
            onChangeText={(value) => {
              setServiceAccount(value);
              setServiceCustomer(null);
              setServiceCustomerError('');
            }}
            autoCapitalize="characters"
            style={styles.inputField}
          />
          <Pressable
            disabled={serviceCustomerLoading}
            onPress={() => void findServiceRequestCustomer()}
            style={styles.secondaryFooterButton}
          >
            <Text style={styles.secondaryFooterText}>
              {serviceCustomerLoading ? translations.findingCustomer : translations.findCustomer}
            </Text>
          </Pressable>
          {serviceCustomerError ? (
            <Text accessibilityRole="alert" style={styles.readingError}>{serviceCustomerError}</Text>
          ) : null}
        </View>
        {serviceCustomer ? (
          <View style={styles.serviceCustomerNotice}>
            <Text style={styles.serviceNoticeTitle}>{serviceCustomer.customerName}</Text>
            <Text style={styles.customerAddress}>{serviceCustomer.address}</Text>
            <Text style={styles.customerAddress}>
              {translations.serviceRequestCustomerAccount} {serviceCustomer.accountNo}{serviceCustomer.meterNo ? ` · ${translations.serviceRequestCustomerMeter} ${serviceCustomer.meterNo}` : ''}
            </Text>
          </View>
        ) : null}
        <View style={styles.fieldBlock}>
          <Text style={styles.labelText}>{translations.serviceRequestProblemType}</Text>
          <Pressable onPress={() => setProblemMenuOpen((open) => !open)} style={styles.problemSelect}>
            <Text style={styles.problemSelectText}>{getServiceProblemLabel(serviceProblem)}</Text>
            <Text style={styles.problemSelectText}>{problemMenuOpen ? '▴' : '▾'}</Text>
          </Pressable>
          {problemMenuOpen ? SERVICE_PROBLEMS.map((problem) => (
            <Pressable
              key={problem}
              onPress={() => {
                setServiceProblem(problem);
                setProblemMenuOpen(false);
              }}
              style={styles.problemOption}
            >
              <Text style={styles.problemOptionText}>{getServiceProblemLabel(problem)}</Text>
            </Pressable>
          )) : null}
        </View>
        <View style={styles.fieldBlock}>
          <Text style={styles.labelText}>{translations.serviceRequestPhoto} <Text style={styles.optionalLabel}>· {translations.optional}</Text></Text>
          {servicePhoto ? (
            <View style={styles.newReadingPhotoPreviewWrapper}>
              <Image source={{ uri: servicePhoto.uri }} style={styles.newReadingPhotoPreview} resizeMode="cover" />
              <View style={styles.newReadingPhotoOverlay}>
                <Pressable onPress={() => setServicePhoto(null)} style={styles.newReadingRetakeBtn}>
                  <Text style={styles.newReadingRetakeBtnText}>✕ {translations.removePhoto}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.photoActionRow}>
              <Pressable onPress={openServiceCamera} style={styles.photoActionPrimary}>
                <Text style={styles.photoActionPrimaryText}>◉  {translations.serviceTakePhoto}</Text>
              </Pressable>
              <Pressable onPress={pickServiceImageFromGallery} style={styles.photoActionSecondary}>
                <Text style={styles.photoActionSecondaryText}>{translations.chooseFromGallery}</Text>
              </Pressable>
            </View>
          )}
        </View>
        <View style={styles.fieldBlock}>
          <Text style={styles.labelText}>{translations.serviceRequestDescription} *</Text>
          <TextInput
            value={serviceDescription}
            onChangeText={(value) => {
              setServiceDescription(value);
              setServiceRequestError('');
            }}
            multiline
            maxLength={500}
            placeholder={translations.describeProblem}
            style={styles.descriptionInput}
          />
          <Text style={styles.characterCount}>{serviceDescription.length} / 500</Text>
        </View>
      </ScrollView>
      <View style={styles.serviceRequestFooter}>
        {serviceRequestError ? (
          <Text accessibilityRole="alert" style={styles.readingError}>{serviceRequestError}</Text>
        ) : null}
        <Pressable
          disabled={serviceRequestSubmitting}
          onPress={() => void submitServiceRequest()}
          style={[styles.primaryButton, serviceRequestSubmitting && styles.readingDisabledButton]}
        >
          <Text style={styles.primaryButtonText}>
            {serviceRequestSubmitting ? translations.submittingServiceRequest : translations.createRequest}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  const renderServiceRequestSubmitted = () => (
    <View style={styles.screenShellDark}>
      <View style={styles.serviceSubmittedContent}>
        <View style={styles.serviceSuccessIcon}><Text style={styles.serviceSuccessCheck}>✓</Text></View>
        <Text style={[styles.heading, styles.serviceSuccessTitle]}>{translations.serviceRequestSubmitted}</Text>
        <Text style={styles.serviceRequestId}>{createdServiceRequest?.id}</Text>
        <Text style={styles.customerAddress}>{createdServiceRequest?.customerName} · {createdServiceRequest?.accountNo}</Text>
        <Text style={styles.serviceProblemText}>
          {createdServiceRequest ? getServiceProblemLabel(createdServiceRequest.problemType) : ''}
        </Text>
        <Text style={styles.servicePendingBadge}>
          ⟳  {createdServiceRequest ? getServiceRequestStatusLabel(createdServiceRequest.status) : ''}
        </Text>
      </View>
      <View style={styles.serviceRequestFooter}>
        <Pressable onPress={() => setScreen('sr')} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{translations.backToServiceRequests}</Text>
        </Pressable>
        <Pressable onPress={openCreateServiceRequest} style={styles.secondaryFooterButton}>
          <Text style={styles.secondaryFooterText}>{translations.createAnotherServiceRequest}</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderWebSidebar = () => (
    <View style={[styles.webSidebar, webSidebarCollapsed && styles.webSidebarCollapsed]}>
      <View style={styles.webSidebarHeader}>
        <Pressable
          accessibilityLabel={webSidebarCollapsed ? 'Expand sidebar' : 'Minimize sidebar'}
          accessibilityRole="button"
          onPress={() => setWebSidebarCollapsed((collapsed) => !collapsed)}
          style={styles.webSidebarToggle}
        >
          <Text style={styles.webSidebarToggleText}>{webSidebarCollapsed ? '›' : '‹'}</Text>
        </Pressable>
      </View>
      <View style={[styles.webBrand, webSidebarCollapsed && styles.webBrandCollapsed]}>
        <Image
          source={require('./assets/cwasa-logo.png')}
          style={[styles.webBrandLogo, webSidebarCollapsed && styles.webBrandLogoCollapsed]}
          resizeMode="contain"
        />
        {!webSidebarCollapsed ? (
          <View>
            <Text style={styles.webBrandTitle}>CWASA</Text>
            <Text style={styles.webBrandCaption}>{translations.meterReading}</Text>
          </View>
        ) : null}
      </View>
      {!webSidebarCollapsed ? <Text style={styles.webSidebarSection}>WORKSPACE</Text> : null}
      <Pressable
        accessibilityLabel={translations.meterReading}
        onPress={() => setScreen('list')}
        style={[screen === 'list' || screen === 'completed' ? styles.webNavActive : styles.webNavItem, webSidebarCollapsed && styles.webNavCollapsed]}
      >
        <Text style={styles.webNavIcon}>◉</Text>
        {!webSidebarCollapsed ? (
          <Text style={screen === 'list' || screen === 'completed' ? styles.webNavActiveText : styles.webNavText}>{translations.meterReading}</Text>
        ) : null}
      </Pressable>
      <Pressable
        onPress={() => {
          setServiceMenuOpen((open) => !open);
          setScreen('sr');
        }}
        accessibilityLabel={translations.serviceRequest}
        style={[
          screen === 'sr' || screen === 'srnew' || screen === 'srdone' ? styles.webNavActive : styles.webNavItem,
          webSidebarCollapsed && styles.webNavCollapsed,
        ]}
      >
        <Text style={styles.webNavIcon}>▤</Text>
        {!webSidebarCollapsed ? (
          <>
            <Text style={screen === 'sr' || screen === 'srnew' || screen === 'srdone' ? styles.webNavActiveText : styles.webNavText}>
              {translations.serviceRequest}
            </Text>
            <Text style={styles.webNavChevron}>{serviceMenuOpen ? '▾' : '▸'}</Text>
          </>
        ) : null}
      </Pressable>
      {serviceMenuOpen && !webSidebarCollapsed ? (
        <View style={styles.webSubNav}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: screen === 'sr' }}
            onPress={(event) => {
              event.stopPropagation();
              setScreen('sr');
            }}
            style={styles.webSubNavItem}
          >
            <Text style={screen === 'sr' ? styles.webSubNavTextActive : styles.webSubNavText}>
              {translations.allServiceRequests}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: screen === 'srnew' }}
            onPress={(event) => {
              event.stopPropagation();
              openCreateServiceRequest();
            }}
            style={styles.webSubNavItem}
          >
            <Text style={screen === 'srnew' ? styles.webSubNavTextActive : styles.webSubNavText}>
              {translations.createRequest}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {!webSidebarCollapsed ? (
        <View style={styles.webAccountMenu}>
          <View style={styles.webAccountIdentity}>
            <View style={styles.webAccountAvatar}><Text style={styles.webAccountAvatarText}>{authAvatarInitial}</Text></View>
            <View style={styles.webAccountIdentityText}>
              <Text style={styles.webAccountName}>{authDisplayName}</Text>
              <Text style={styles.webAccountMeta}>{authAccountMeta}</Text>
            </View>
          </View>
          <Pressable onPress={() => setScreen('profile')} style={styles.webAccountMenuItem}>
            <Text style={styles.webAccountMenuText}>{translations.profile}</Text>
          </Pressable>
          <Pressable
            onPress={() => setLanguage((current) => (current === 'en' ? 'bn' : 'en'))}
            style={styles.webAccountMenuItem}
          >
            <Text style={styles.webAccountMenuText}>{translations.language}</Text>
            <Text style={styles.webAccountLanguage}>{language === 'en' ? 'বাংলা | EN' : 'EN | বাংলা'}</Text>
          </Pressable>
          <Pressable onPress={logOut} style={styles.webAccountMenuItem}>
            <Text style={styles.webAccountLogout}>{translations.logOut}</Text>
          </Pressable>
        </View>
      ) : null}
      {!webSidebarCollapsed ? (
        <View style={styles.webSidebarFooter}>
        </View>
      ) : null}
    </View>
  );

  const renderWebList = () => (
    <View style={styles.webDashboard}>
      {renderWebSidebar()}
      <View style={styles.webMain}>
        <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
          <View>
            <Text style={styles.webBreadcrumb}></Text>
            <Text style={styles.webPageTitle}>{translations.meterReading}</Text>
          </View>
          <View style={styles.webTopActions}>
            <Pressable
              onPress={() => setLanguage((current) => (current === 'en' ? 'bn' : 'en'))}
              style={styles.webLanguageButton}
            >
              <Text style={styles.webLanguageText}>{language === 'en' ? 'বাংলা | EN' : 'EN | বাংলা'}</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.webContent}
          contentContainerStyle={[styles.webContentInner, styles.webPageFooterSpace, isCompactWeb && styles.webContentInnerCompact]}
        >
          <View style={styles.webWelcomeRow}>
            <View>
              <Text style={styles.webWelcomeTitle}>{translations.welcomeGreeting}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Pressable
                onPress={() => {
                  resetNewReadingForm();
                  setScreen('newReading');
                }}
                style={styles.webPrimaryButton}
              >
                <Text style={styles.webPrimaryButtonText}>＋  {translations.newReading}</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.webStatsRow, isCompactWeb && styles.webStatsRowCompact]}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: readingDashboardTab === 'pending' }}
              onPress={() => {
                setReadingDashboardTab('pending');
                setSearchText('');
              }}
              style={[
                styles.webStatCard,
                styles.webStatCardButton,
                styles.webStatCardPending,
                readingDashboardTab === 'pending' && styles.webStatCardPendingActive,
                isCompactWeb && styles.webStatCardCompact,
              ]}
            >
              <Text style={[styles.webStatLabel, styles.webStatPendingText]}>{translations.pendingReadings}</Text>
              <Text style={[styles.webStatValue, styles.webStatPendingText]}>{assignedCustomers.length}</Text>
              <Text style={styles.webStatHint}>{translations.awaitingAdminReview}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: readingDashboardTab === 'completed' }}
              onPress={() => {
                setReadingDashboardTab('completed');
                setSearchText('');
              }}
              style={[
                styles.webStatCard,
                styles.webStatCardButton,
                styles.webStatCardCompleted,
                readingDashboardTab === 'completed' && styles.webStatCardCompletedActive,
                isCompactWeb && styles.webStatCardCompact,
              ]}
            >
              <Text style={[styles.webStatLabel, styles.webStatCompletedText]}>{translations.completedReadings}</Text>
              <Text style={[styles.webStatValue, styles.webStatCompletedText]}>{completedReadings.length}</Text>
              <Text style={styles.webStatHint}>{translations.completedThisCycle}</Text>
            </Pressable>
          </View>

          <View style={styles.webPanel}>
            <View style={[styles.webPanelHeading, isCompactWeb && styles.webPanelHeadingCompact]}>
              <View style={isCompactWeb && styles.webPanelHeadingText}>
                <Text style={styles.webPanelTitle}>
                  {readingDashboardTab === 'pending' ? translations.pendingReadings : translations.completedReadings}
                </Text>
              </View>
              <Text style={styles.webRecordCount}>
                {readingDashboardTab === 'pending' ? filteredCustomers.length : filteredCompletedReadings.length} {translations.recordCountSuffix}
              </Text>
            </View>

            <View style={styles.webToolbar}>
              <View style={styles.webSearchField}>
                <Text style={styles.searchIcon}>⌕</Text>
                <TextInput
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholder={`${translations.search}: ${translations.searchPlaceholder}`}
                  placeholderTextColor="#5B6275"
                  style={styles.webSearchInput}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: readingFilterOpen }}
                onPress={() => {
                  if (!readingFilterOpen) setDraftWardFilter(wardFilter);
                  if (!readingFilterOpen) setDraftBillApprovalFilter(billApprovalFilter);
                  setWardOptionOpen(false);
                  setReadingFilterOpen((open) => !open);
                }}
                style={[styles.webFilterTriggerButton, wardFilter !== 'all' && styles.webFilterTriggerButtonActive]}
              >
                <Text style={[styles.filterTriggerText, wardFilter !== 'all' && styles.filterTriggerTextActive]}>
                  {translations.filter}{activeReadingFilterCount > 0 ? ` · ${activeReadingFilterCount}` : ''}
                </Text>
              </Pressable>
            </View>
            {renderReadingFilterPanel()}

            {readingDashboardTab === 'pending' && assignedCustomersLoading ? (
              <Text style={styles.webPanelSubtitle}>{translations.loadingSubmittedReadings}</Text>
            ) : readingDashboardTab === 'pending' && assignedCustomersError ? (
              <View style={styles.emptyFilteredBox}>
                <Text accessibilityRole="alert" style={styles.emptyFilteredTitle}>{assignedCustomersError}</Text>
                <Pressable
                  onPress={() => setAssignedCustomersRefreshKey((value) => value + 1)}
                  style={styles.emptyFilteredResetBtn}
                >
                  <Text style={styles.emptyFilteredResetBtnText}>Retry</Text>
                </Pressable>
              </View>
            ) : null}
            {readingDashboardTab === 'completed' && completedReadingsLoading ? (
              <Text style={styles.webPanelSubtitle}>{translations.loadingCompletedReadings}</Text>
            ) : null}
            {readingDashboardTab === 'completed' && completedReadingsError ? (
              <View style={styles.emptyFilteredBox}>
                <Text accessibilityRole="alert" style={styles.emptyFilteredTitle}>{completedReadingsError}</Text>
                <Pressable onPress={() => setAssignedCustomersRefreshKey((value) => value + 1)} style={styles.emptyFilteredResetBtn}>
                  <Text style={styles.emptyFilteredResetBtnText}>{translations.retry}</Text>
                </Pressable>
              </View>
            ) : null}

            {readingDashboardTab === 'pending' && !isCompactWeb ? (
              <View style={styles.webTableHeader}>
                <Text style={[styles.webTableHeaderText, styles.webCustomerColumn]}>{translations.dashboardCustomer}</Text>
                <Text style={[styles.webTableHeaderText, styles.webAccountColumn]}>{translations.dashboardAccountMeter}</Text>
                <Text style={[styles.webTableHeaderText, styles.webStatusColumn]}>{translations.dashboardStatus}</Text>
                <Text style={[styles.webTableHeaderText, styles.webAmountColumn]}>{translations.dashboardBillAmount}</Text>
              </View>
            ) : null}

            {readingDashboardTab === 'pending' && !assignedCustomersLoading && !assignedCustomersError ? filteredCustomers.map((customer) => (
              <Pressable
                key={customer.id}
                onPress={() => {
                  setSelectedCustomer(customer);
                  setScreen('detail');
                }}
                style={isCompactWeb ? styles.webMobileCustomerRow : styles.webTableRow}
              >
                {isCompactWeb ? (
                  <>
                    <View style={styles.webMobileCustomerTop}>
                      <Text style={styles.webCustomerName}>{customer.name}</Text>
                      <Text style={[styles.webAmountText, { color: customer.color }]}>{customer.amt}</Text>
                    </View>
                    <Text style={styles.webCustomerAddress}>{customer.addr}</Text>
                    {customer.wardNo ? <Text style={styles.webCustomerAddress}>{translations.ward} {customer.wardNo}</Text> : null}
                    <View style={styles.webMobileCustomerBottom}>
                      <Text style={styles.webTableSecondaryText}>{customer.acc} · {translations.meter} {customer.meter}</Text>
                      <View style={styles.webMobileBadgesRow}>
                        <Text style={[styles.webStatusBadge, { color: customer.color, backgroundColor: `${customer.color}14` }]}>
                          {translations.pending}
                        </Text>
                        <View style={styles.badgeApprovalReq}>
                          <Text style={styles.badgeApprovalReqText}>{translations.awaitingAdminReview}</Text>
                        </View>
                      </View>
                    </View>
                    {customer.flag ? <Text style={styles.webComplaint}>{translations.complaint}</Text> : null}
                  </>
                ) : (
                  <>
                    <View style={styles.webCustomerColumn}>
                      <Text style={styles.webCustomerName}>{customer.name}</Text>
                      <Text style={styles.webCustomerAddress}>{customer.addr}</Text>
                      {customer.wardNo ? <Text style={styles.webCustomerAddress}>{translations.ward} {customer.wardNo}</Text> : null}
                      {customer.flag ? <Text style={styles.webComplaint}>{translations.complaint}</Text> : null}
                    </View>
                    <View style={styles.webAccountColumn}>
                      <Text style={styles.webTableMainText}>{customer.acc}</Text>
                      <Text style={styles.webTableSecondaryText}>{translations.meter} {customer.meter}</Text>
                    </View>
                    <View style={styles.webStatusColumn}>
                      <Text style={[styles.webStatusBadge, { color: customer.color, backgroundColor: `${customer.color}14` }]}>
                        {translations.pending}
                      </Text>
                      <View style={styles.webBadgeApprovalReq}>
                        <Text style={styles.webBadgeApprovalReqText}>{translations.awaitingAdminReview}</Text>
                      </View>
                    </View>
                    <View style={[styles.webAmountColumn, styles.webAmountCell]}>
                      <Text style={[styles.webAmountText, { color: customer.color }]}>{customer.amt}</Text>
                      <Text style={styles.webRowArrow}>›</Text>
                    </View>
                  </>
                )}
              </Pressable>
            )) : null}
            {readingDashboardTab === 'pending' && !assignedCustomersLoading && !assignedCustomersError && filteredCustomers.length === 0 ? (
              <View style={styles.emptyFilteredBox}>
                <Text style={styles.emptyFilteredIcon}>📋</Text>
                <Text style={styles.emptyFilteredTitle}>
                  {getReadingEmptyMessage(assignedCustomers.length, translations.noPendingReadings)}
                </Text>
              </View>
            ) : null}
            {readingDashboardTab === 'completed' && !isCompactWeb ? (
              <View style={styles.completedReadingTableHeader}>
                <Text style={styles.completedReadingIdentity}>{translations.customerDetails} / {translations.accountNumber}</Text>
                <Text style={styles.completedReadingValueColumn}>{translations.currentBill}</Text>
                <Text style={styles.completedReadingUsageColumn}>{translations.completed}</Text>
                <Text style={styles.completedReadingDateColumn}>{translations.readingDate}</Text>
              </View>
            ) : null}
            {readingDashboardTab === 'completed' && !completedReadingsLoading && !completedReadingsError && filteredCompletedReadings.length === 0 ? (
              <View style={styles.emptyFilteredBox}>
                <Text style={styles.emptyFilteredIcon}>✓</Text>
                <Text style={styles.emptyFilteredTitle}>
                  {getReadingEmptyMessage(completedReadings.length, translations.noCompletedReadings)}
                </Text>
              </View>
            ) : null}
            {readingDashboardTab === 'completed' && !completedReadingsLoading && !completedReadingsError
              ? filteredCompletedReadings.map(renderCompletedRecord)
              : null}
          </View>
          {renderWebPageFooter()}
        </ScrollView>
      </View>
    </View>
  );

  const renderCompletedRecord = (record: CompletedReading) => (
    isWeb && !isCompactWeb ? (
      <View key={record.id} style={styles.completedReadingTableRow}>
        <View style={styles.completedReadingIdentity}>
          <Text style={styles.webCustomerName}>{record.customer}</Text>
          <Text style={styles.webTableSecondaryText}>{record.account} · {translations.meter} {record.meter}{record.wardNo ? ` · ${translations.ward} ${record.wardNo}` : ''}</Text>
        </View>
        <View style={styles.completedReadingValueColumn}>
          <Text style={styles.completedReadingValue}>{record.current}</Text>
        </View>
        <View style={styles.completedReadingUsageColumn}>
          <Text style={styles.completedReadingUsage}>{translations.completed}</Text>
        </View>
        <View style={styles.completedReadingDateColumn}>
          <Text style={styles.webTableSecondaryText}>{record.date}</Text>
        </View>
      </View>
    ) : (
      <View key={record.id} style={styles.completedReadingCard}>
        <View style={styles.completedReadingCardHeader}>
          <View style={styles.completedReadingIdentity}>
            <Text style={styles.webCustomerName}>{record.customer}</Text>
            <Text style={styles.webTableSecondaryText}>{record.account} · {translations.meter} {record.meter}{record.wardNo ? ` · ${translations.ward} ${record.wardNo}` : ''}</Text>
          </View>
          <Text style={styles.completedReadingUsage}>{record.current}</Text>
        </View>
        <View style={styles.completedReadingCardFooter}>
          <Text style={styles.webTableSecondaryText}>
            {translations.completed} · {record.date}
          </Text>
        </View>
      </View>
    )
  );

  const renderCompletedReadings = () => (
    isWeb ? (
      <View style={styles.webDashboard}>
        {renderWebSidebar()}
        <View style={styles.webMain}>
          <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
            <View>
              <Text style={styles.webPageTitle}>{translations.completedReadings}</Text>
            </View>
            <Pressable onPress={() => setScreen('list')} style={styles.webBackButton}>
              <Text style={styles.webBackButtonText}>←  {translations.meterReading}</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.webContent} contentContainerStyle={[styles.webContentInner, styles.webPageFooterSpace, isCompactWeb && styles.webContentInnerCompact]}>
            <View style={styles.completedReadingsSummary}>
              <View>
                <Text style={styles.completedReadingsCount}>{completedReadings.length}</Text>
                <Text style={styles.webStatHint}>{translations.completedThisCycle}</Text>
              </View>
            </View>
            <View style={styles.webPanel}>
              <View style={styles.webToolbar}>
                <View style={styles.webSearchField}>
                  <Text style={styles.searchIcon}>⌕</Text>
                  <TextInput
                    value={searchText}
                    onChangeText={setSearchText}
                    placeholder={`${translations.search}: ${translations.searchPlaceholder}`}
                    placeholderTextColor="#5B6275"
                    style={styles.webSearchInput}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: readingFilterOpen }}
                  onPress={() => {
                    if (!readingFilterOpen) setDraftWardFilter(wardFilter);
                    if (!readingFilterOpen) setDraftBillApprovalFilter(billApprovalFilter);
                    setWardOptionOpen(false);
                    setReadingFilterOpen((open) => !open);
                  }}
                  style={[styles.webFilterTriggerButton, wardFilter !== 'all' && styles.webFilterTriggerButtonActive]}
                >
                  <Text style={[styles.filterTriggerText, wardFilter !== 'all' && styles.filterTriggerTextActive]}>
                    {translations.filter}{activeReadingFilterCount > 0 ? ` · ${activeReadingFilterCount}` : ''}
                  </Text>
                </Pressable>
              </View>
              {renderReadingFilterPanel()}
              {!isCompactWeb ? (
                <View style={styles.completedReadingTableHeader}>
                  <Text style={styles.completedReadingIdentity}>{translations.customerDetails} / {translations.accountNumber}</Text>
                  <Text style={styles.completedReadingValueColumn}>{translations.currentBill}</Text>
                  <Text style={styles.completedReadingUsageColumn}>{translations.completed}</Text>
                  <Text style={styles.completedReadingDateColumn}>{translations.readingDate}</Text>
                </View>
              ) : null}
              {completedReadingsLoading ? <Text style={styles.webPanelSubtitle}>{translations.loadingCompletedReadings}</Text> : null}
              {completedReadingsError ? (
                <View>
                  <Text accessibilityRole="alert" style={styles.readingError}>{completedReadingsError}</Text>
                  <Pressable onPress={() => setAssignedCustomersRefreshKey((value) => value + 1)}>
                    <Text style={styles.emptyFilteredResetBtnText}>{translations.retry}</Text>
                  </Pressable>
                </View>
              ) : null}
              {!completedReadingsLoading && !completedReadingsError && filteredCompletedReadings.length === 0
                ? <Text style={styles.webPanelSubtitle}>{getReadingEmptyMessage(completedReadings.length, translations.noCompletedReadings)}</Text>
                : null}
              {filteredCompletedReadings.map(renderCompletedRecord)}
            </View>
            {renderWebPageFooter()}
          </ScrollView>
        </View>
      </View>
    ) : (
      <View style={styles.screenShellDark}>
        <View style={styles.topBar}>
          <Pressable onPress={() => setScreen('list')} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>←</Text>
          </Pressable>
          <Text style={[styles.heading, styles.topBarTitle]}>{translations.completedReadings}</Text>
        </View>
        <View style={styles.completedReadingsSummary}>
          <View>
            <Text style={styles.completedReadingsCount}>{completedReadings.length}</Text>
            <Text style={styles.webStatHint}>{translations.completedThisCycle}</Text>
          </View>
        </View>
        <View style={styles.searchArea}>
          <View style={styles.searchFieldContainer}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder={`${translations.search}: ${translations.searchPlaceholder}`}
              placeholderTextColor="#5B6275"
              style={styles.searchInput}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: readingFilterOpen }}
            onPress={() => {
              if (!readingFilterOpen) setDraftWardFilter(wardFilter);
              if (!readingFilterOpen) setDraftBillApprovalFilter(billApprovalFilter);
              setWardOptionOpen(false);
              setReadingFilterOpen((open) => !open);
            }}
            style={[styles.filterTriggerButton, wardFilter !== 'all' && styles.filterTriggerButtonActive]}
          >
            <Text style={[styles.filterTriggerText, wardFilter !== 'all' && styles.filterTriggerTextActive]}>
              {translations.filter}{activeReadingFilterCount > 0 ? ` · ${activeReadingFilterCount}` : ''}
            </Text>
          </Pressable>
        </View>
        {renderReadingFilterPanel()}
        <ScrollView style={styles.customerList} contentContainerStyle={styles.completedReadingsList}>
          {completedReadingsLoading ? <Text style={styles.webPanelSubtitle}>{translations.loadingCompletedReadings}</Text> : null}
          {completedReadingsError ? (
            <View>
              <Text accessibilityRole="alert" style={styles.readingError}>{completedReadingsError}</Text>
              <Pressable onPress={() => setAssignedCustomersRefreshKey((value) => value + 1)}>
                <Text style={styles.emptyFilteredResetBtnText}>{translations.retry}</Text>
              </Pressable>
            </View>
          ) : null}
          {!completedReadingsLoading && !completedReadingsError && filteredCompletedReadings.length === 0
            ? <Text style={styles.webPanelSubtitle}>{getReadingEmptyMessage(completedReadings.length, translations.noCompletedReadings)}</Text>
            : null}
          {filteredCompletedReadings.map(renderCompletedRecord)}
        </ScrollView>
        <View style={styles.bottomNav}>
          <Pressable onPress={() => setScreen('list')} style={styles.bottomNavItem}>
            <Text style={styles.navIcon}>◉</Text>
            <Text style={styles.navLabel}>{translations.meterReading}</Text>
          </Pressable>
          <Pressable onPress={() => setScreen('sr')} style={styles.bottomNavItem}>
            <Text style={styles.navIcon}>▤</Text>
            <Text style={styles.navLabel}>{translations.serviceRequest}</Text>
          </Pressable>
        </View>
      </View>
    )
  );

  const renderWebServiceRequests = () => (
    <View style={styles.webDashboard}>
      {renderWebSidebar()}
      <View style={styles.webMain}>
        <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
          <View>
            <Text style={styles.webPageTitle}>{translations.serviceRequest}</Text>
          </View>
          <Pressable onPress={openCreateServiceRequest} style={styles.webPrimaryButton}>
            <Text style={styles.webPrimaryButtonText}>＋  {translations.createServiceRequest}</Text>
          </Pressable>
        </View>
        {renderServiceRequestFilterModal()}
        <ScrollView
          style={styles.webContent}
          contentContainerStyle={[styles.webContentInner, styles.webPageFooterSpace, isCompactWeb && styles.webContentInnerCompact]}
        >
          <View style={styles.webPanel}>
            <View style={[
              styles.webPanelHeading,
              styles.webServiceRequestHeadingLayer,
              isCompactWeb && styles.webPanelHeadingCompact,
              isCompactWeb && styles.webServiceRequestHeadingCompact,
            ]}>
              <View style={isCompactWeb && styles.webPanelHeadingText}>
                <Text style={styles.webPanelTitle}>{translations.serviceRequest}</Text>
                <Text style={styles.webPanelSubtitle}>{translations.serviceRequestListDescription}</Text>
              </View>
              <View style={[styles.webServiceRequestControls, isCompactWeb && styles.webServiceRequestControlsCompact]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: serviceRequestFilterOpen }}
                  onPress={openServiceRequestFilter}
                  style={[styles.webFilterTriggerButton, serviceRequestFilter !== 'all' && styles.webFilterTriggerButtonActive]}
                >
                  <Text style={[styles.webFilterTriggerText, serviceRequestFilter !== 'all' && styles.filterTriggerTextActive]}>
                    {translations.filter}{serviceRequestFilter !== 'all' ? ' · 1' : ''}
                  </Text>
                </Pressable>
                <Text style={[styles.webRecordCount, isCompactWeb && styles.webServiceRequestRecordCountCompact]}>
                  {filteredServiceRequests.length} {translations.serviceRequest}
                </Text>
              </View>
            </View>
            {serviceRequestsLoading ? (
              <Text style={styles.webPanelSubtitle}>{translations.serviceRequestLoading}</Text>
            ) : serviceRequestsError ? (
              <View style={styles.emptyFilteredBox}>
                <Text accessibilityRole="alert" style={styles.emptyFilteredTitle}>{serviceRequestsError}</Text>
                <Pressable onPress={() => setServiceRequestsRefreshKey((key) => key + 1)} style={styles.emptyFilteredResetBtn}>
                  <Text style={styles.emptyFilteredResetBtnText}>Retry</Text>
                </Pressable>
              </View>
            ) : filteredServiceRequests.length === 0 ? (
              renderServiceRequestsEmptyState()
            ) : filteredServiceRequests.map((request) => (
              <View key={request.id} style={[styles.webRequestRow, isCompactWeb && styles.webRequestRowCompact]}>
                <View style={styles.webRequestIcon}><Text style={styles.webRequestIconText}>⚠</Text></View>
                <View style={[styles.webRequestIdentity, isCompactWeb && styles.webRequestIdentityCompact]}>
                  <Text style={styles.webCustomerName}>{request.customerName}</Text>
                  <Text style={styles.webCustomerAddress}>
                    {request.accountNo}{request.meterNo ? ` · ${request.meterNo}` : ''} · {request.address}
                  </Text>
                  <Text style={styles.webCustomerAddress}>{request.description}</Text>
                </View>
                <Text style={styles.webRequestProblem}>{getServiceProblemLabel(request.problemType)}</Text>
                <Text style={styles.webRequestStatus}>{getServiceRequestStatusLabel(request.status)}</Text>
              </View>
            ))}
          </View>
          {renderWebPageFooter()}
        </ScrollView>
      </View>
    </View>
  );

  const renderWebCreateServiceRequest = () => (
    <View style={styles.webDashboard}>
      {renderWebSidebar()}
      <View style={styles.webMain}>
        <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
          <View>
            <Text style={styles.webPageTitle}>{translations.createServiceRequest}</Text>
          </View>
          <Pressable onPress={() => setScreen('sr')} style={styles.webBackButton}>
            <Text style={styles.webBackButtonText}>←  {translations.backToServiceRequests}</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.webContent}
          contentContainerStyle={[styles.webDetailContent, styles.webPageFooterSpace, isCompactWeb && styles.webDetailContentCompact]}
        >
          <View style={[styles.webFormPanel, isCompactWeb && styles.webFormPanelCompact]}>
            <View style={styles.fieldBlock}>
              <Text style={styles.labelText}>{translations.serviceRequestCustomerNumber} *</Text>
              <TextInput
                value={serviceAccount}
                onChangeText={(value) => {
                  setServiceAccount(value);
                  setServiceCustomer(null);
                  setServiceCustomerError('');
                }}
                autoCapitalize="characters"
                style={styles.webFormInput}
              />
              <Pressable
                disabled={serviceCustomerLoading}
                onPress={() => void findServiceRequestCustomer()}
                style={styles.secondaryFooterButton}
              >
                <Text style={styles.secondaryFooterText}>
                  {serviceCustomerLoading ? translations.findingCustomer : translations.findCustomer}
                </Text>
              </Pressable>
              {serviceCustomerError ? (
                <Text accessibilityRole="alert" style={styles.readingError}>{serviceCustomerError}</Text>
              ) : null}
            </View>
            {serviceCustomer ? (
              <View style={styles.serviceCustomerNotice}>
                <Text style={styles.serviceNoticeTitle}>{serviceCustomer.customerName}</Text>
                <Text style={styles.customerAddress}>{serviceCustomer.address}</Text>
                <Text style={styles.customerAddress}>
                  {translations.serviceRequestCustomerAccount} {serviceCustomer.accountNo}{serviceCustomer.meterNo ? ` · ${translations.serviceRequestCustomerMeter} ${serviceCustomer.meterNo}` : ''}
                </Text>
              </View>
            ) : null}
            <View style={styles.fieldBlock}>
              <Text style={styles.labelText}>{translations.serviceRequestProblemType}</Text>
              <Pressable onPress={() => setProblemMenuOpen((open) => !open)} style={styles.problemSelect}>
                <Text style={styles.problemSelectText}>{getServiceProblemLabel(serviceProblem)}</Text>
                <Text style={styles.problemSelectText}>{problemMenuOpen ? '▴' : '▾'}</Text>
              </Pressable>
              {problemMenuOpen ? SERVICE_PROBLEMS.map((problem) => (
                <Pressable
                  key={problem}
                  onPress={() => {
                    setServiceProblem(problem);
                    setProblemMenuOpen(false);
                  }}
                  style={styles.problemOption}
                >
                  <Text style={styles.problemOptionText}>{getServiceProblemLabel(problem)}</Text>
                </Pressable>
              )) : null}
            </View>
            <View style={styles.fieldBlock}>
              <Text style={styles.labelText}>{translations.serviceRequestPhoto} <Text style={styles.optionalLabel}>· {translations.optional}</Text></Text>
              {servicePhoto ? (
                <View style={styles.newReadingPhotoPreviewWrapper}>
                  <Image source={{ uri: servicePhoto.uri }} style={styles.newReadingPhotoPreview} resizeMode="cover" />
                  <View style={styles.newReadingPhotoOverlay}>
                    <Pressable onPress={() => setServicePhoto(null)} style={styles.newReadingRetakeBtn}>
                      <Text style={styles.newReadingRetakeBtnText}>✕ {translations.removePhoto}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.photoActionRow}>
                  <Pressable onPress={openServiceCamera} style={styles.photoActionPrimary}>
                    <Text style={styles.photoActionPrimaryText}>◉  {translations.serviceTakePhoto}</Text>
                  </Pressable>
                  <Pressable onPress={pickServiceImageFromGallery} style={styles.photoActionSecondary}>
                    <Text style={styles.photoActionSecondaryText}>{translations.chooseFromGallery}</Text>
                  </Pressable>
                </View>
              )}
            </View>
            <View style={styles.fieldBlock}>
              <Text style={styles.labelText}>{translations.serviceRequestDescription} *</Text>
              <TextInput
                value={serviceDescription}
                onChangeText={(value) => {
                  setServiceDescription(value);
                  setServiceRequestError('');
                }}
                multiline
                maxLength={500}
                placeholder={translations.describeProblem}
                style={styles.descriptionInput}
              />
              <Text style={styles.characterCount}>{serviceDescription.length} / 500</Text>
            </View>
            {serviceRequestError ? (
              <Text accessibilityRole="alert" style={styles.readingError}>{serviceRequestError}</Text>
            ) : null}
            <Pressable
              disabled={serviceRequestSubmitting}
              onPress={() => void submitServiceRequest()}
              style={[styles.primaryButton, serviceRequestSubmitting && styles.readingDisabledButton]}
            >
              <Text style={styles.primaryButtonText}>
                {serviceRequestSubmitting ? translations.submittingServiceRequest : translations.createRequest}
              </Text>
            </Pressable>
          </View>
          {renderWebPageFooter()}
        </ScrollView>
      </View>
    </View>
  );

  const renderWebServiceRequestSubmitted = () => (
    <View style={styles.webDashboard}>
      {renderWebSidebar()}
      <View style={styles.webMain}>
        <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
          <View>
            <Text style={styles.webPageTitle}>{translations.serviceRequestSubmitted}</Text>
          </View>
        </View>
        <View style={styles.webSuccessPage}>
          <View style={styles.serviceSuccessIcon}><Text style={styles.serviceSuccessCheck}>✓</Text></View>
          <Text style={[styles.heading, styles.serviceSuccessTitle]}>{translations.serviceRequestSubmitted}</Text>
          <Text style={styles.serviceRequestId}>{createdServiceRequest?.id}</Text>
          <Text style={styles.customerAddress}>
            {createdServiceRequest?.customerName} · {translations.serviceRequestCustomerAccount} {createdServiceRequest?.accountNo}
          </Text>
          <Text style={styles.serviceProblemText}>
            {createdServiceRequest ? getServiceProblemLabel(createdServiceRequest.problemType) : ''}
          </Text>
          <Text style={styles.servicePendingBadge}>
            ⟳  {createdServiceRequest ? getServiceRequestStatusLabel(createdServiceRequest.status) : ''}
          </Text>
          <View style={styles.webSuccessActions}>
            <Pressable onPress={() => setScreen('sr')} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{translations.backToServiceRequests}</Text>
            </Pressable>
            <Pressable onPress={openCreateServiceRequest} style={styles.secondaryFooterButton}>
              <Text style={styles.secondaryFooterText}>{translations.createAnotherServiceRequest}</Text>
            </Pressable>
          </View>
          {renderWebPageFooter()}
        </View>
      </View>
    </View>
  );

  const renderWebDetail = () => (
    <View style={styles.webDashboard}>
      {renderWebSidebar()}
      <View style={styles.webMain}>
        <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
          <View>
            <Text style={styles.webBreadcrumb}>WORKSPACE  /  CUSTOMER</Text>
            <Text style={styles.webPageTitle}>{translations.customerDetails}</Text>
          </View>
          <Pressable onPress={() => setScreen('list')} style={styles.webBackButton}>
            <Text style={styles.webBackButtonText}>←  Back to readings</Text>
          </Pressable>
        </View>
        <ScrollView
          style={styles.webContent}
          contentContainerStyle={[styles.webDetailContent, styles.webPageFooterSpace, isCompactWeb && styles.webDetailContentCompact]}
        >
          <View style={styles.customerSummaryCard}>
            <View style={styles.customerSummaryTop}>
              <View style={styles.customerTypeTags}>
                {selectedCustomer.customerType ? <Text style={styles.customerTypeTag}>{translations.domestic}</Text> : null}
                {selectedCustomer.meterType ? <Text style={styles.customerTypeTag}>{translations.metered}</Text> : null}
              </View>
              <View style={styles.customerDue}>
                <Text style={[styles.customerDueAmount, { color: selectedCustomer.color }]}>{selectedCustomer.amt}</Text>
                <Text style={styles.customerSummaryDueLabel}>
                  {selectedCustomer.dueLabel === 'Due' ? translations.due : translations.noDue}
                </Text>
              </View>
            </View>
            <Text style={styles.customerSummaryName}>{selectedCustomer.name}</Text>
            <Text style={styles.customerSummaryText}>{selectedCustomer.detailAddress || selectedCustomer.addr}</Text>
            <Text style={styles.customerSummaryText}>✆  {selectedCustomer.phone || translations.notOnFile}</Text>
          </View>
          <View style={styles.webDetailTabs}>
            <Pressable
              onPress={() => setDetailTab('bill')}
              style={detailTab === 'bill' ? styles.webDetailTabActive : styles.webDetailTab}
            >
              <Text style={detailTab === 'bill' ? styles.webDetailTabTextActive : styles.webDetailTabText}>{translations.generateBill}</Text>
            </Pressable>
            <Pressable
              onPress={() => setDetailTab('history')}
              style={detailTab === 'history' ? styles.webDetailTabActive : styles.webDetailTab}
            >
              <Text style={detailTab === 'history' ? styles.webDetailTabTextActive : styles.webDetailTabText}>{translations.history}</Text>
            </Pressable>
          </View>
          {detailTab === 'bill' ? (
            <>
              <View style={styles.customerMetadataCard}>
                {[
                  [translations.accountNumber, selectedCustomer.acc],
                  [translations.area, selectedCustomer.area || '—'],
                  [translations.ward, selectedCustomer.ward || '—'],
                  [translations.meterNo, selectedCustomer.meter],
                  [translations.connectionSize, selectedCustomer.connectionSize || '—'],
                ].map(([label, value], index) => (
                  <View
                    key={label}
                    style={[styles.customerMetadataRow, index === 4 && styles.customerMetadataRowLast]}
                  >
                    <Text style={styles.customerMetadataLabel}>{label}</Text>
                    <Text style={styles.customerMetadataValue}>{value}</Text>
                  </View>
                ))}
              </View>
              {selectedCustomer.previousReading ? (
                <View style={styles.previousReadingCard}>
                  <Text style={styles.previousReadingLabel}>
                    {translations.previousReading} (m³){selectedCustomer.previousReadingDate ? ` · ${selectedCustomer.previousReadingDate}` : ''}
                  </Text>
                  <Text style={styles.previousReadingValue}>{selectedCustomer.previousReading}</Text>
                </View>
              ) : null}
              {selectedCustomer.nearbyDistance ? (
                <View style={styles.customerNearbyNotice}>
                  <Text style={styles.customerNearbyText}>
                    ✓  {translations.nearCustomer.replace('{distance}', selectedCustomer.nearbyDistance)}
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.webPanel}>
              <Text style={styles.historyText}>10 Mar 2026 — Reading taken successfully</Text>
              <Text style={styles.historyText}>17 Feb 2026 — Meter inspection completed</Text>
              <Text style={styles.historyText}>09 Jan 2026 — Complaint resolved</Text>
            </View>
          )}
          {renderWebPageFooter()}
        </ScrollView>
        <View style={styles.customerDetailFooter}>
          <Pressable onPress={openNewReadingForSelectedCustomer} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>＋  New Reading</Text>
          </Pressable>
          <Pressable onPress={beginReading} style={styles.secondaryFooterButton}>
            <Text style={styles.secondaryFooterText}>◉  {translations.takePhoto}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const renderDetail = () => (
    <View style={styles.screenShellDark}>
      <View style={styles.topBar}>
        <Pressable onPress={() => setScreen('list')} style={styles.iconButton}>
          <Text style={styles.iconButtonText}>←</Text>
        </Pressable>
        <Text style={[styles.heading, styles.topBarTitle]}>{translations.customerDetails}</Text>
      </View>

      <View style={styles.tabRowDetail}>
        <Pressable
          onPress={() => setDetailTab('bill')}
          style={detailTab === 'bill' ? styles.tabItemActiveDetail : styles.tabItemInactiveDetail}
        >
          <Text style={detailTab === 'bill' ? styles.tabTextActive : styles.tabTextInactive}>{translations.generateBill}</Text>
        </Pressable>
        <Pressable
          onPress={() => setDetailTab('history')}
          style={detailTab === 'history' ? styles.tabItemActiveDetail : styles.tabItemInactiveDetail}
        >
          <Text style={detailTab === 'history' ? styles.tabTextActive : styles.tabTextInactive}>{translations.history}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
        <View style={styles.customerSummaryCard}>
          <View style={styles.customerSummaryTop}>
            <View style={styles.customerTypeTags}>
              {selectedCustomer.customerType ? <Text style={styles.customerTypeTag}>{translations.domestic}</Text> : null}
              {selectedCustomer.meterType ? <Text style={styles.customerTypeTag}>{translations.metered}</Text> : null}
            </View>
            <View style={styles.customerDue}>
              <Text style={[styles.customerDueAmount, { color: selectedCustomer.color }]}>{selectedCustomer.amt}</Text>
              <Text style={styles.customerSummaryDueLabel}>
                {selectedCustomer.dueLabel === 'Due' ? translations.due : translations.noDue}
              </Text>
            </View>
          </View>
          <Text style={styles.customerSummaryName}>{selectedCustomer.name}</Text>
          <Text style={styles.customerSummaryText}>{selectedCustomer.detailAddress || selectedCustomer.addr}</Text>
          <Text style={styles.customerSummaryText}>✆  {selectedCustomer.phone || translations.notOnFile}</Text>
        </View>

        {detailTab === 'bill' ? (
          <>
            <View style={styles.customerMetadataCard}>
              {[
                [translations.accountNumber, selectedCustomer.acc],
                [translations.area, selectedCustomer.area || '—'],
                [translations.ward, selectedCustomer.ward || '—'],
                [translations.meterNo, selectedCustomer.meter],
                [translations.connectionSize, selectedCustomer.connectionSize || '—'],
              ].map(([label, value], index) => (
                <View
                  key={label}
                  style={[styles.customerMetadataRow, index === 4 && styles.customerMetadataRowLast]}
                >
                  <Text style={styles.customerMetadataLabel}>{label}</Text>
                  <Text style={styles.customerMetadataValue}>{value}</Text>
                </View>
              ))}
            </View>
            {selectedCustomer.previousReading ? (
              <View style={styles.previousReadingCard}>
                <Text style={styles.previousReadingLabel}>
                  {translations.previousReading} (m³){selectedCustomer.previousReadingDate ? ` · ${selectedCustomer.previousReadingDate}` : ''}
                </Text>
                <Text style={styles.previousReadingValue}>{selectedCustomer.previousReading}</Text>
              </View>
            ) : null}
            {selectedCustomer.nearbyDistance ? (
              <View style={styles.customerNearbyNotice}>
                <Text style={styles.customerNearbyText}>
                  ✓  {translations.nearCustomer.replace('{distance}', selectedCustomer.nearbyDistance)}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.detailCard}>
            <Text style={styles.historyText}>10 Mar 2026 — Reading taken successfully</Text>
            <Text style={styles.historyText}>17 Feb 2026 — Meter inspection completed</Text>
            <Text style={styles.historyText}>09 Jan 2026 — Complaint resolved</Text>
          </View>
        )}
      </ScrollView>
      <View style={styles.customerDetailFooter}>
        <Pressable onPress={openNewReadingForSelectedCustomer} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>＋  New Reading</Text>
        </Pressable>
        <Pressable onPress={beginReading} style={styles.secondaryFooterButton}>
          <Text style={styles.secondaryFooterText}>◉  {translations.takePhoto}</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderCamera = () => {

    const activePhoto = cameraTarget === 'newReading' ? newReadingPhoto : cameraTarget === 'service' ? servicePhoto : cameraPhoto;
    const returnScreen = cameraTarget === 'newReading' ? 'newReading' : cameraTarget === 'service' ? 'srnew' : 'detail';
    const nextScreen = cameraTarget === 'newReading' ? 'newReading' : cameraTarget === 'service' ? 'srnew' : 'enter';

    return (
      <ScrollView
        style={styles.cameraScreenScroll}
        contentContainerStyle={[styles.cameraScreen, styles.webPageFooterSpace]}
      >
        <View style={styles.cameraTopBar}>
          <Pressable onPress={() => setScreen(returnScreen)} style={styles.cameraCancelButton}>
            <Text style={styles.cameraCancelText}>×  Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setCameraFacing((facing) => (facing === 'back' ? 'front' : 'back'))}
            style={styles.cameraCancelButton}
          >
            <Text style={styles.cameraFlashText}>↻  Flip</Text>
          </Pressable>
        </View>
        <Text style={styles.cameraInstruction}>Fit the whole meter face inside the frame</Text>
        <View style={styles.cameraPreview}>
          {activePhoto ? (
            <Image source={{ uri: activePhoto.uri }} style={styles.cameraPreviewLive} resizeMode="contain" />
          ) : cameraPermission?.granted && cameraAvailable ? (
            <CameraView
              ref={cameraRef}
              facing={cameraFacing}
              onCameraReady={() => setCameraReady(true)}
              onMountError={(event) => {
                setCameraReady(false);
                setCameraError(event.message || translations.cameraNotAvailable);
              }}
              style={styles.cameraPreviewLive}
            />
          ) : (
            <View style={styles.cameraPreviewMessage}>
              <Text style={styles.cameraPreviewText}>
                {cameraAvailable === false
                  ? translations.cameraNotAvailable
                  : cameraPermission?.canAskAgain === false
                    ? translations.cameraPermissionDenied
                    : translations.cameraPreviewUnavailable}
              </Text>
              {!cameraPermission?.granted && cameraPermission?.canAskAgain !== false ? (
                <Pressable onPress={allowCamera} style={styles.cameraPermissionButton}>
                  <Text style={styles.cameraPermissionButtonText}>{translations.cameraPermissionAction}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
        <View style={styles.cameraBottom}>
          {cameraError ? <Text accessibilityRole="alert" style={styles.cameraErrorText}>{cameraError}</Text> : null}
          {activePhoto ? (
            <>
              <Pressable onPress={retakeMeterPhoto} style={styles.cameraSecondaryButton}>
                <Text style={styles.cameraSecondaryButtonText}>{translations.cameraRetakePhoto}</Text>
              </Pressable>
              <Pressable onPress={() => setScreen(nextScreen)} style={styles.cameraContinueButton}>
                <Text style={styles.cameraContinueButtonText}>{translations.cameraUsePhoto}</Text>
              </Pressable>
            </>
          ) : (
            <>
              {cameraPermission?.granted && cameraAvailable ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={!cameraReady}
                  onPress={captureMeterPhoto}
                  style={[styles.cameraContinueButton, !cameraReady && styles.cameraDisabledButton]}
                >
                  <Text style={styles.cameraContinueButtonText}>{translations.cameraTakePhoto}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setScreen(nextScreen)} style={styles.cameraSecondaryButton}>
                <Text style={styles.cameraSecondaryButtonText}>{translations.continueWithoutPhoto}</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    );
  };

  const renderReadingEntryContent = () => (
    <>
      <View style={styles.readingPreviousCard}>
        <Text style={styles.readingPreviousLabel}>
          {translations.previousReadingValue} · {selectedCustomer.previousReadingDate || '31/08/2026'}
        </Text>
        <Text style={styles.readingPreviousValue}>{previousReadingValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} m³</Text>
      </View>

      <View style={styles.readingInputCard}>
        <Text style={styles.readingSectionLabel}>{translations.currentReadingLabel}</Text>
        <TextInput
          value={reading}
          onChangeText={(value) => {
            setReading(value);
            setReadingConfirmed(false);
          }}
          keyboardType="decimal-pad"
          style={styles.readingInput}
          accessibilityLabel={translations.currentReadingLabel}
        />
        <Text style={styles.readingHelper}>{translations.typeMeterValue}</Text>
      </View>

      {reading.trim() !== '' && !Number.isFinite(currentReadingValue) ? (
        <Text accessibilityRole="alert" style={styles.readingError}>{translations.readingMustBeNumeric}</Text>
      ) : null}
      {reading.trim() !== '' && Number.isFinite(currentReadingValue) && currentReadingValue < previousReadingValue ? (
        <View style={styles.readingWarningCard}>
          <Text style={styles.readingWarningTitle}>✕  {translations.readingLowerThanPrevious}</Text>
          <Text style={styles.readingWarningText}>
            {translations.previousReadingValue}: {previousReadingValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} m³
          </Text>
        </View>
      ) : null}
      {isHighReading ? (
        <View style={styles.readingWarningCard}>
          <Text style={styles.readingWarningTitle}>⚠  {translations.highUseWarning}</Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: readingConfirmed }}
            onPress={() => setReadingConfirmed((checked) => !checked)}
            style={styles.readingConfirmRow}
          >
            <Text style={styles.readingCheckbox}>{readingConfirmed ? '☑' : '☐'}</Text>
            <Text style={styles.readingWarningText}>{translations.checkedReading}</Text>
          </Pressable>
        </View>
      ) : null}
      {isZeroReading ? (
        <View style={styles.readingWarningCard}>
          <Text style={styles.readingWarningTitle}>⚠  {translations.zeroUseWarning}</Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: readingConfirmed }}
            onPress={() => setReadingConfirmed((checked) => !checked)}
            style={styles.readingConfirmRow}
          >
            <Text style={styles.readingCheckbox}>{readingConfirmed ? '☑' : '☐'}</Text>
            <Text style={styles.readingWarningText}>{translations.checkedReading}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.readingUsageCard}>
        <View>
          <Text style={styles.readingUsageLabel}>{translations.useThisCycle} (m³)</Text>
          <Text style={styles.readingHelper}>{translations.typeMeterValue}</Text>
        </View>
        <Text style={styles.readingUsageValue}>
          {readingIsValid ? cycleUsage.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
        </Text>
      </View>

      <View style={styles.readingConditionCard}>
        <Text style={styles.readingSectionLabel}>{translations.meterCondition}</Text>
        <View style={styles.readingConditionOptions}>
          {([
            ['normal', translations.workingNormally],
            ['damaged', translations.meterDamaged],
            ['stopped', translations.meterStopped],
          ] as const).map(([condition, label]) => (
            <Pressable
              key={condition}
              accessibilityRole="radio"
              accessibilityState={{ selected: meterCondition === condition }}
              onPress={() => setMeterCondition(condition)}
              style={[styles.readingConditionOption, meterCondition === condition && styles.readingConditionOptionSelected]}
            >
              <Text style={[styles.readingConditionText, meterCondition === condition && styles.readingConditionTextSelected]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.readingRemarksBlock}>
        <Text style={styles.readingSectionLabel}>{translations.remarks}</Text>
        <TextInput
          value={readingRemarks}
          onChangeText={setReadingRemarks}
          multiline
          maxLength={300}
          placeholder={translations.remarks}
          style={styles.readingRemarksInput}
        />
        {isHighReading && readingRemarks.trim().length === 0 ? (
          <Text accessibilityRole="alert" style={styles.readingError}>{translations.remarksRequired}</Text>
        ) : null}
      </View>
    </>
  );

  const renderReadingEntry = () => (
    isWeb ? (
      <View style={styles.webDashboard}>
        {renderWebSidebar()}
        <View style={styles.webMain}>
          <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
            <View>
              <Text style={styles.webPageTitle}>{translations.currentReading}</Text>
            </View>
            <Pressable onPress={() => setScreen('detail')} style={styles.webBackButton}>
              <Text style={styles.webBackButtonText}>←  {translations.customerDetails}</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.webContent} contentContainerStyle={[styles.readingWorkflowContent, styles.webPageFooterSpace, isCompactWeb && styles.webContentInnerCompact]}>
            <View style={styles.readingCustomerBanner}>
              <Text style={styles.readingCustomerName}>{selectedCustomer.name}</Text>
              <Text style={styles.readingHelper}>{selectedCustomer.acc} · {translations.meter} {selectedCustomer.meter}</Text>
            </View>
            {renderReadingEntryContent()}
            {renderWebPageFooter()}
          </ScrollView>
          <View style={styles.customerDetailFooter}>
            <Pressable
              disabled={!canReviewReading}
              onPress={() => setScreen('review')}
              style={[styles.primaryButton, !canReviewReading && styles.readingDisabledButton]}
            >
              <Text style={styles.primaryButtonText}>{translations.reviewReading}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    ) : (
      <View style={styles.screenShellDark}>
        <View style={styles.topBar}>
          <Pressable onPress={() => setScreen('camera')} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>←</Text>
          </Pressable>
          <Text style={[styles.heading, styles.topBarTitle]}>{translations.currentReading}</Text>
        </View>
        <ScrollView style={styles.readingWorkflowScroll} contentContainerStyle={styles.readingWorkflowContent}>
          <View style={styles.readingCustomerBanner}>
            <Text style={styles.readingCustomerName}>{selectedCustomer.name}</Text>
            <Text style={styles.readingHelper}>{selectedCustomer.acc} · {translations.meter} {selectedCustomer.meter}</Text>
          </View>
          {renderReadingEntryContent()}
        </ScrollView>
        <View style={styles.customerDetailFooter}>
          <Pressable
            disabled={!canReviewReading}
            onPress={() => setScreen('review')}
            style={[styles.primaryButton, !canReviewReading && styles.readingDisabledButton]}
          >
            <Text style={styles.primaryButtonText}>{translations.reviewReading}</Text>
          </Pressable>
        </View>
      </View>
    )
  );

  const renderReviewContent = () => (
    <View style={styles.readingReviewCard}>
      <View style={styles.readingReviewCustomer}>
        <Text style={styles.readingCustomerName}>{selectedCustomer.name}</Text>
        <Text style={styles.readingHelper}>{selectedCustomer.acc} · {translations.meter} {selectedCustomer.meter}</Text>
      </View>
      {[
        [translations.previousReadingValue, `${previousReadingValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} m³`],
        [translations.readingValue, `${currentReadingValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} m³`],
        [translations.useThisCycle, `${cycleUsage.toLocaleString('en-US', { minimumFractionDigits: 2 })} m³`],
        [translations.meterCondition, meterCondition === 'normal' ? translations.workingNormally : meterCondition === 'damaged' ? translations.meterDamaged : translations.meterStopped],
      ].map(([label, value]) => (
        <View key={label} style={styles.readingReviewRow}>
          <Text style={styles.readingReviewLabel}>{label}</Text>
          <Text style={styles.readingReviewValue}>{value}</Text>
        </View>
      ))}
      {readingRemarks.trim() ? (
        <View style={styles.readingReviewRemarks}>
          <Text style={styles.readingReviewLabel}>{translations.remarks}</Text>
          <Text style={styles.readingReviewValue}>{readingRemarks}</Text>
        </View>
      ) : null}
      {cameraPhoto ? <Image source={{ uri: cameraPhoto.uri }} style={styles.readingPhotoThumbnail} resizeMode="cover" /> : null}
    </View>
  );

  const renderReadingReview = () => (
    isWeb ? (
      <View style={styles.webDashboard}>
        {renderWebSidebar()}
        <View style={styles.webMain}>
          <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
            <View>  
              <Text style={styles.webPageTitle}>{translations.reviewReading}</Text>
            </View>
            <Pressable onPress={() => setScreen('enter')} style={styles.webBackButton}>
              <Text style={styles.webBackButtonText}>←  {translations.currentReading}</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.webContent} contentContainerStyle={[styles.readingWorkflowContent, styles.webPageFooterSpace]}>
            {renderReviewContent()}
            {renderWebPageFooter()}
          </ScrollView>
          <View style={styles.customerDetailFooter}>
            <Pressable onPress={() => setScreen('saved')} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{translations.saveReading}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    ) : (
      <View style={styles.screenShellDark}>
        <View style={styles.topBar}>
          <Pressable onPress={() => setScreen('enter')} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>←</Text>
          </Pressable>
          <Text style={[styles.heading, styles.topBarTitle]}>{translations.reviewReading}</Text>
        </View>
        <ScrollView style={styles.readingWorkflowScroll} contentContainerStyle={styles.readingWorkflowContent}>
          {renderReviewContent()}
        </ScrollView>
        <View style={styles.customerDetailFooter}>
          <Pressable onPress={() => setScreen('saved')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{translations.saveReading}</Text>
          </Pressable>
        </View>
      </View>
    )
  );

  const goToNextCustomer = () => {
    if (assignedCustomers.length === 0) return;
    const currentIndex = assignedCustomers.findIndex((customer) => customer.id === selectedCustomer.id);
    const nextCustomer = assignedCustomers[(currentIndex + 1) % assignedCustomers.length];
    setSelectedCustomer(nextCustomer);
    const nextPreviousReading = Number(
      nextCustomer.previousReading?.replace(/,/g, '')
      || '4295',
    );
    setReading((nextPreviousReading + 82).toFixed(2));
    setReadingRemarks('');
    setReadingConfirmed(false);
    setMeterCondition('normal');
    setScreen('detail');
  };

  const renderReadingSaved = () => {
    const content = (
      <View style={styles.readingSavedCard}>
        <View style={styles.serviceSuccessIcon}><Text style={styles.serviceSuccessCheck}>✓</Text></View>
        <Text style={[styles.heading, styles.serviceSuccessTitle]}>{translations.readingSaved}</Text>
        <Text style={styles.readingSavedUse}>{cycleUsage.toLocaleString('en-US', { minimumFractionDigits: 2 })} m³</Text>
        <View style={styles.readingSavedBillRow}>
          <Text style={styles.readingReviewLabel}>Water charge (example)</Text>
          <Text style={styles.readingReviewValue}>৳1,697</Text>
        </View>
        <View style={styles.readingSavedBillRow}>
          <Text style={styles.readingReviewLabel}>Previous due</Text>
          <Text style={styles.readingReviewValue}>{selectedCustomer.amt}</Text>
        </View>
        <Text style={styles.readingHelper}>{translations.readingSavedOffline}</Text>
      </View>
    );

    return isWeb ? (
      <View style={styles.webDashboard}>
        {renderWebSidebar()}
        <View style={styles.webMain}>
          <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
            <View>

              <Text style={styles.webPageTitle}>{translations.readingSaved}</Text>
            </View>
          </View>
          <ScrollView style={styles.webContent} contentContainerStyle={[styles.readingWorkflowContent, styles.webPageFooterSpace]}>
            {content}
            {renderWebPageFooter()}
          </ScrollView>
          <View style={styles.readingSavedActions}>
            <Pressable onPress={goToNextCustomer} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{translations.nextCustomer}</Text>
            </Pressable>
            <Pressable onPress={() => setScreen('list')} style={styles.secondaryFooterButton}>
              <Text style={styles.secondaryFooterText}>{translations.backToDashboard}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    ) : (
      <View style={styles.screenShellDark}>
        <ScrollView style={styles.readingWorkflowScroll} contentContainerStyle={styles.readingSavedContent}>{content}</ScrollView>
        <View style={styles.readingSavedActions}>
          <Pressable onPress={goToNextCustomer} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{translations.nextCustomer}</Text>
          </Pressable>
          <Pressable onPress={() => setScreen('list')} style={styles.secondaryFooterButton}>
            <Text style={styles.secondaryFooterText}>{translations.backToDashboard}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderNewReading = () => {
    const hasPhoto = Boolean(newReadingPhoto);
    const formContent = (
      <View style={styles.newReadingCard}>
        <View style={styles.newReadingHeader}>
          <Text style={styles.newReadingHeaderTitle}>{translations.newReading}</Text>
          <Text style={styles.newReadingHeaderSubtitle}>{translations.newReadingSubtitle}</Text>
        </View>

        {newReadingSuccessMsg ? (
          <View style={styles.newReadingSuccessBanner}>
            <Text style={styles.newReadingSuccessBannerText}>✓  {newReadingSuccessMsg}</Text>
          </View>
        ) : null}
        {newReadingErrorMsg ? (
          <Text accessibilityRole="alert" style={styles.readingError}>{newReadingErrorMsg}</Text>
        ) : null}

        {/* 1. Meter Number / Account Number */}
        <View style={styles.fieldBlock}>
          <View style={styles.newReadingLabelRow}>
            <Text style={styles.labelText}>
              {translations.meterOrAccount} <Text style={{ color: '#E02424' }}>*</Text>
            </Text>
            {newReadingAutoFetching ? (
              <Text style={styles.newReadingFetchingBadge}>⟳ Auto-populating...</Text>
            ) : newReadingForm.customerName ? (
              <Text style={styles.newReadingAutoFetchedBadge}>✓ Details auto-populated</Text>
            ) : null}
          </View>
          <TextInput
            value={newReadingForm.meterOrAccount}
            onChangeText={handleMeterOrAccountChange}
            placeholder="Type Meter No (eg 340007M6)"
            placeholderTextColor="#8A93A8"
            style={styles.inputField}
          />
          {newReadingLookupError ? (
            <Text accessibilityRole="alert" style={styles.readingError}>{newReadingLookupError}</Text>
          ) : null}
        </View>

        {/* 2. Customer Name (Auto-filled, Not Editable) */}
        <View style={styles.fieldBlock}>
          <View style={styles.newReadingLabelRow}>
            <Text style={styles.labelText}>{translations.customerName}</Text>
          </View>
          <TextInput
            value={newReadingForm.customerName}
            editable={false}
            selectTextOnFocus={false}
            placeholder="Auto-fills"
            placeholderTextColor="#9AA4B8"
            style={[styles.inputField, styles.inputFieldReadOnly]}
          />
        </View>

        {/* 3. MOD (Mode of Delivery / Ward - Auto-filled, Not Editable) */}
        <View style={styles.fieldBlock}>
          <View style={styles.newReadingLabelRow}>
            <Text style={styles.labelText}>{translations.mod}</Text>
          </View>
          <TextInput
            value={newReadingForm.mod}
            editable={false}
            selectTextOnFocus={false}
            placeholder="Auto-fills"
            placeholderTextColor="#9AA4B8"
            style={[styles.inputField, styles.inputFieldReadOnly]}
          />
        </View>

        {/* 4. Previous Bill (Auto-filled, Not Editable) */}
        <View style={styles.fieldBlock}>
          <View style={styles.newReadingLabelRow}>
            <Text style={styles.labelText}>{translations.previousBill}</Text>
          </View>
          <TextInput
            value={newReadingForm.previousBill}
            editable={false}
            selectTextOnFocus={false}
            placeholder="Auto-fills"
            placeholderTextColor="#9AA4B8"
            style={[styles.inputField, styles.inputFieldReadOnly]}
          />
        </View>

        {/* 5. Current Bill (Manual Input Required) */}
        <View style={styles.fieldBlock}>
          <View style={styles.newReadingLabelRow}>
            <Text style={styles.labelText}>
              {translations.currentBill} <Text style={{ color: '#E02424' }}>*</Text>
            </Text>
            <Text style={styles.newReadingRequiredTag}>Input required</Text>
          </View>
          <TextInput
            value={newReadingForm.currentBill}
            onChangeText={(val) => {
              setNewReadingSuccessMsg('');
              setNewReadingForm((prev) => ({ ...prev, currentBill: val }));
            }}
            placeholder="Enter current bill"
            placeholderTextColor="#8A93A8"
            keyboardType="decimal-pad"
            style={[styles.inputField, styles.inputFieldHighlight]}
          />
        </View>

        {/* 6. Location Input with device GPS collector */}
        <View style={styles.fieldBlock}>
          <Text style={styles.labelText}>{translations.deviceLocation}</Text>
          <View style={styles.newReadingLocationBox}>
            <View style={styles.newReadingLocationDetails}>
              {newReadingForm.latitude && newReadingForm.longitude ? (
                <View style={styles.gpsCoordsContainer}>
                  <View style={styles.gpsCoordsGrid}>
                    <View style={styles.gpsCoordCard}>
                      <Text style={styles.gpsCoordLabel}>LATITUDE</Text>
                      <Text style={styles.gpsCoordValue}>{newReadingForm.latitude}° N</Text>
                    </View>
                    <View style={styles.gpsCoordCard}>
                      <Text style={styles.gpsCoordLabel}>LONGITUDE</Text>
                      <Text style={styles.gpsCoordValue}>{newReadingForm.longitude}° E</Text>
                    </View>
                  </View>
                  <Text style={styles.newReadingLocationStatusText}>
                    ✓ {translations.locationSuccess}
                  </Text>
                </View>
              ) : (
                <Text style={styles.newReadingLocationPlaceholder}>
                  {newReadingLocationLoading
                    ? translations.fetchingLocation
                    : 'No GPS coordinates acquired yet. Tap button to access device GPS.'}
                </Text>
              )}
            </View>

            <Pressable
              disabled={newReadingLocationLoading}
              onPress={fetchDeviceLocation}
              style={[styles.newReadingLocationButton, newReadingLocationLoading && styles.cameraDisabledButton]}
            >
              <Text style={styles.newReadingLocationButtonText}>
                {newReadingLocationLoading ? '⟳ Getting GPS...' : '📍 Access Device GPS'}
              </Text>
            </Pressable>
            {newReadingLocationError ? (
              <Text accessibilityRole="alert" style={styles.readingError}>{newReadingLocationError}</Text>
            ) : null}
          </View>
        </View>

        {/* 7. Photo Input */}
        <View style={styles.fieldBlock}>
          <Text style={styles.labelText}>{translations.meterPhotoLabel} <Text style={{ color: '#E02424' }}>*</Text></Text>
          {hasPhoto && newReadingPhoto ? (
            <View style={styles.newReadingPhotoPreviewWrapper}>
              <Image source={{ uri: newReadingPhoto.uri }} style={styles.newReadingPhotoPreview} resizeMode="cover" />
              <View style={[styles.newReadingPhotoActions, isCompactWeb && styles.newReadingPhotoActionsCompact]}>
                <Pressable
                  onPress={openNewReadingCamera}
                  accessibilityRole="button"
                  accessibilityLabel={translations.retakePhoto}
                  style={({ pressed }) => [styles.secondaryFooterButton, styles.newReadingPhotoActionButton, isCompactWeb && styles.newReadingPhotoActionButtonCompact, pressed && styles.newReadingPhotoButtonPressed]}
                >
                  <Text style={[styles.secondaryFooterText, styles.newReadingPhotoButtonText]}>↻ {translations.retakePhoto}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void chooseNewReadingPhotoFromGallery()}
                  accessibilityRole="button"
                  accessibilityLabel={translations.chooseFromGallery}
                  style={({ pressed }) => [styles.secondaryFooterButton, styles.newReadingPhotoActionButton, isCompactWeb && styles.newReadingPhotoActionButtonCompact, pressed && styles.newReadingPhotoButtonPressed]}
                >
                  <Text style={[styles.secondaryFooterText, styles.newReadingPhotoButtonText]}>{translations.chooseFromGallery}</Text>
                </Pressable>
              </View>
              <Text style={styles.readingHelper}>
                {translations.photoResizedTo} {newReadingPhoto.width} × {newReadingPhoto.height} {translations.pixelsBeforeUpload}
              </Text>
            </View>
          ) : (
            <>
              <View style={[styles.newReadingPhotoActions, isCompactWeb && styles.newReadingPhotoActionsCompact]}>
                <Pressable
                  onPress={openNewReadingCamera}
                  accessibilityRole="button"
                  accessibilityLabel={translations.takePhoto}
                  style={({ pressed }) => [styles.primaryButton, styles.newReadingPhotoActionButton, isCompactWeb && styles.newReadingPhotoActionButtonCompact, pressed && styles.newReadingPhotoButtonPressed]}
                >
                  <Text style={[styles.primaryButtonText, styles.newReadingPhotoButtonText]}>📷 {translations.takePhoto}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void chooseNewReadingPhotoFromGallery()}
                  accessibilityRole="button"
                  accessibilityLabel={translations.chooseFromGallery}
                  style={({ pressed }) => [styles.secondaryFooterButton, styles.newReadingPhotoActionButton, isCompactWeb && styles.newReadingPhotoActionButtonCompact, pressed && styles.newReadingPhotoButtonPressed]}
                >
                  <Text style={[styles.secondaryFooterText, styles.newReadingPhotoButtonText]}>{translations.chooseFromGallery}</Text>
                </Pressable>
              </View>
              <Text style={[styles.readingHelper, styles.newReadingPhotoRequiredHint]}>{translations.meterPhotoRequired}</Text>
            </>
          )}
        </View>

        {/* Submit and Action Buttons */}
        <View style={styles.newReadingActionRow}>
          <Pressable
            disabled={newReadingSaving}
            onPress={() => void submitNewReadingForm()}
            style={[styles.primaryButton, newReadingSaving && styles.readingDisabledButton]}
          >
            <Text style={styles.primaryButtonText}>
              {newReadingSaving ? 'Saving reading...' : translations.submitNewReading}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              resetNewReadingForm();
              setScreen('list');
            }}
            style={styles.secondaryFooterButton}
          >
            <Text style={styles.secondaryFooterText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );

    return isWeb ? (
      <View style={styles.webDashboard}>
        {renderWebSidebar()}
        <View style={styles.webMain}>
          <View style={[styles.webTopBar, isCompactWeb && styles.webTopBarCompact]}>
            <View>
              <Text style={styles.webPageTitle}>{translations.newReading}</Text>
            </View>
            <Pressable onPress={() => setScreen('list')} style={styles.webBackButton}>
              <Text style={styles.webBackButtonText}>←  {translations.meterReading}</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.webContent}
            contentContainerStyle={[styles.newReadingScrollContent, styles.webPageFooterSpace, isCompactWeb && styles.webContentInnerCompact]}
          >
            {formContent}
            {renderWebPageFooter()}
          </ScrollView>
        </View>
      </View>
    ) : (
      <View style={styles.screenShellDark}>
        <View style={styles.topBar}>
          <Pressable onPress={() => setScreen('list')} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>←</Text>
          </Pressable>
          <Text style={[styles.heading, styles.topBarTitle]}>{translations.newReading}</Text>
        </View>
        <ScrollView style={styles.readingWorkflowScroll} contentContainerStyle={styles.newReadingScrollContent}>
          {formContent}
        </ScrollView>
      </View>
    );
  };

  if (!fontsLoaded) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading app...</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.appRoot, isWeb && styles.appRootWeb]}>
        <StatusBar style={screen === 'list' || screen === 'completed' || screen === 'detail' || screen === 'camera' || screen === 'enter' || screen === 'review' || screen === 'saved' || screen === 'newReading' ? 'light' : 'dark'} />
        <View style={[styles.deviceShell, isWeb && styles.deviceShellWeb, isWeb && (isCompactWeb || isShortScreen) && styles.deviceShellWebCompact]}>
          {screen === 'splash' ? renderSplash() : null}
          {screen === 'signin' ? renderSignIn() : null}
          {screen === 'admin' && authUser?.role === 'admin' ? (
            <AdminPanel language={language} onSignOut={logOut} />
          ) : null}
          {screen === 'profile' ? renderProfile() : null}
          {screen === 'camera' ? renderCamera() : null}
          {screen === 'enter' ? renderReadingEntry() : null}
          {screen === 'review' ? renderReadingReview() : null}
          {screen === 'saved' ? renderReadingSaved() : null}
          {screen === 'newReading' ? renderNewReading() : null}
          {screen === 'list' && isWeb ? renderWebList() : null}
          {screen === 'list' && !isWeb ? renderList() : null}
          {screen === 'completed' ? renderCompletedReadings() : null}
          {screen === 'detail' && isWeb ? renderWebDetail() : null}
          {screen === 'detail' && !isWeb ? renderDetail() : null}
          {screen === 'sr' && isWeb ? renderWebServiceRequests() : null}
          {screen === 'sr' && !isWeb ? renderServiceRequestList() : null}
          {screen === 'srnew' && isWeb ? renderWebCreateServiceRequest() : null}
          {screen === 'srnew' && !isWeb ? renderCreateServiceRequest() : null}
          {screen === 'srdone' && isWeb ? renderWebServiceRequestSubmitted() : null}
          {screen === 'srdone' && !isWeb ? renderServiceRequestSubmitted() : null}
          {!isWeb && drawerOpen ? renderAccountDrawer() : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
