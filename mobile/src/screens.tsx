import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ApiError,
  apiGet,
  apiSend,
  AnnualReport,
  DashboardData,
  DuplicatePayment,
  getServerUrl,
  Household,
  HouseholdDetail,
  MonthlyReport,
  Payment,
  checkServer,
  checkExistingPayment,
  configureServer,
  signOut,
  signIn,
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
import {
  buildHouseholdStatementHtml,
  buildReceiptHtml,
  buildReportHtml,
  receiptPdfTitle,
  reportPdfTitle,
  reportPaymentAmount,
  reconcileAnnualMonthlyReports,
} from './documents';
import { DocumentActionSheet } from './DocumentActionSheet';
import { deliverPdf, PdfAction } from './pdf-actions';
import {
  businessDate,
  calendarDateString,
  isSelectablePaymentDate,
  parseCalendarDate,
} from './dates';
import { formatInrFromPaise } from './money';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function businessMonth() {
  const [year, month] = businessDate().split('-').map(Number);
  return { year, month };
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function paymentMode(mode: Payment['payment_mode']) {
  return mode === 'upi' ? 'UPI' : mode === 'split' ? 'Split' : 'Cash';
}

interface DocumentRequest {
  title: string;
  html: string;
}

function duplicateFromError(error: ApiError): DuplicatePayment | null {
  if (typeof error.responseBody !== 'object' || error.responseBody === null) return null;
  const duplicate = (error.responseBody as { duplicate?: unknown }).duplicate;
  if (typeof duplicate !== 'object' || duplicate === null) return null;
  const record = duplicate as Record<string, unknown>;
  const paymentModeValue = record.payment_mode;
  if (
    typeof record.id !== 'number'
    || typeof record.amount_paise !== 'number'
    || (paymentModeValue !== 'cash' && paymentModeValue !== 'upi' && paymentModeValue !== 'split')
    || typeof record.payment_date !== 'string'
    || typeof record.cash_amount_paise !== 'number'
    || typeof record.upi_amount_paise !== 'number'
  ) {
    return null;
  }
  return {
    id: record.id,
    amount_paise: record.amount_paise,
    payment_mode: paymentModeValue,
    cash_amount_paise: record.cash_amount_paise,
    upi_amount_paise: record.upi_amount_paise,
    payment_date: record.payment_date,
  };
}

function BrandLockup({ centered = false }: { centered?: boolean }) {
  const colors = usePalette();
  return (
    <View style={[styles.brandLockup, centered && styles.brandLockupCentered]}>
      <Image
        accessibilityLabel="Masjid E Shameem"
        source={require('../assets/icon.png')}
        style={styles.brandIconSmall}
      />
      <Text style={[styles.brandName, { color: colors.text }]}>MASJID E SHAMEEM</Text>
      <View style={[styles.brandSlash, { backgroundColor: colors.gold }]} />
    </View>
  );
}

export function LoginScreen({
  onLogin,
  initialError,
}: {
  onLogin: (user: User) => void;
  initialError?: string;
}) {
  const colors = usePalette();
  const { width } = useWindowDimensions();
  const [server, setServer] = useState('');
  const serverLabel = server.replace(/^https?:\/\//, '').split('.')[0] || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(initialError || '');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    getServerUrl()
      .then((url) => { if (url) setServer(url); })
      .catch((cause) => setError(messageOf(cause)));
  }, []);

  const connect = async () => {
    setChecking(true);
    setError('');
    setConnected(false);
    try {
      await configureServer(server);
      const health = await checkServer();
      if (!health.ok) throw new Error('The server is online but its database is unavailable.');
      setConnected(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      onLogin(await signIn(server, email, password));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.loginRoot, { backgroundColor: colors.background }]}>
      <GridBackdrop />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.loginKeyboard}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.loginContent,
            {
              width: '100%',
              maxWidth: 480,
              alignSelf: 'center',
              paddingHorizontal: width < 360 ? 20 : 24,
            },
          ]}
        >
          <View style={styles.loginBrand}>
            <BrandLockup centered />
            <Heading
              title="Chanda Manager"
              subtitle="Assalamualaikum. Sign in to your Masjid E Shameem account."
              align="center"
            />
          </View>
          <Card>
            <Field
              label="API environment"
              value={serverLabel}
              editable={false}
              accessibilityLabel={`Configured API environment: ${server}`}
            />
            <Button
              label={connected ? 'Server connected' : 'Check server'}
              variant="secondary"
              onPress={connect}
              busy={checking}
              disabled={!server.trim()}
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.org"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              accessibilityLabel="Email"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              secureTextEntry
              textContentType="password"
              accessibilityLabel="Password"
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            {error ? <Notice>{error}</Notice> : null}
            <Button
              label="Sign in"
              onPress={submit}
              busy={busy}
              disabled={!server.trim() || !email.trim() || !password}
            />
          </Card>
          <Text style={[styles.loginFootnote, { color: colors.muted }]}>
            {Platform.OS === 'web'
              ? 'Web preview keeps your session in memory only.'
              : 'Use the HTTPS address provided by your administrator. Your session is stored securely on this device.'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const colors = usePalette();
  return (
    <Card style={styles.metric}>
      <Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
    </Card>
  );
}

export function DashboardScreen({
  user,
  onRecordPayment,
  refreshKey,
}: {
  user: User;
  onRecordPayment: () => void;
  refreshKey: number;
}) {
  const colors = usePalette();
  const { width } = useWindowDimensions();
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setData(await apiGet<DashboardData>('/api/dashboard'));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiGet<DashboardData>('/api/dashboard')
      .then((result) => {
        if (active) {
          setData(result);
          setError('');
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(messageOf(cause));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, [refreshKey]);

  return (
    <Screen>
      <BrandLockup />
      <Heading
        title={data?.month_label || 'Collection overview'}
        subtitle={`Assalamualaikum, ${user.name.split(' ')[0]}${data ? ` · ${data.active_households} active households` : ''}`}
      />
      {error ? <Notice>{error}</Notice> : null}
      {busy && !data ? <LoadingState label="Loading your dashboard…" /> : null}
      {data ? (
        <>
          <Card style={[styles.collectionHero, { backgroundColor: colors.green, borderColor: colors.green }]}>
            <Text style={[styles.heroLabel, { color: colors.onGreenMuted }]}>Total collected</Text>
            <Text
              style={[
                styles.heroAmount,
                { color: colors.onGreen, fontSize: width < 360 ? 26 : width < 400 ? 29 : 32 },
              ]}
              selectable
              adjustsFontSizeToFit
              numberOfLines={1}
            >
              {formatInrFromPaise(data.total_collection_paise)}
            </Text>
            <View style={[styles.summarySplit, { borderTopColor: 'rgba(255,255,255,0.28)' }]}>
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryLabel, { color: colors.onGreenMuted }]}>Cash</Text>
                <Text style={[styles.summaryValue, { color: colors.onGreen }]}>{formatInrFromPaise(data.cash_paise)}</Text>
              </View>
              <View style={[styles.summaryCell, styles.summaryCellTrailing, { borderLeftColor: 'rgba(255,255,255,0.28)' }]}>
                <Text style={[styles.summaryLabel, { color: colors.onGreenMuted }]}>UPI</Text>
                <Text style={[styles.summaryValue, { color: colors.onGreen }]}>{formatInrFromPaise(data.upi_paise)}</Text>
              </View>
            </View>
            <View style={styles.summaryStatus}>
              <Text style={[styles.summaryLabel, { color: colors.onGreenMuted }]}>
                {data.households_paid} paid · {data.households_pending} pending
              </Text>
              <Text style={[styles.summaryLabel, { color: colors.onGreenMuted }]}>
                {data.active_households} active
              </Text>
            </View>
          </Card>
          <Button label="Record payment" onPress={onRecordPayment} />
          <View style={styles.sectionHeader}>
            <SectionTitle>Recent payments</SectionTitle>
            <Button label="Refresh" variant="plain" onPress={() => { void load(); }} busy={busy} />
          </View>
          {data.recent.length ? data.recent.map((payment) => (
            <View key={payment.id} style={[styles.paymentRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.houseCode, { color: colors.green }]}>{payment.house_no}</Text>
              <View style={styles.grow}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
                  {payment.household_name}
                </Text>
                <Text style={{ color: colors.muted }}>
                  {dateLabel(payment.payment_date)} · {paymentMode(payment.payment_mode)}
                </Text>
              </View>
              <Text style={[styles.amount, { color: colors.greenText }]}>{formatInrFromPaise(payment.amount)}</Text>
            </View>
          )) : (
            <Card><Text style={{ color: colors.muted }}>No payments have been recorded yet.</Text></Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}

export function CollectionsScreen({ onPaymentRecorded }: { onPaymentRecorded: () => void }) {
  const colors = usePalette();
  const now = useMemo(() => businessMonth(), []);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [selected, setSelected] = useState<Household | null>(null);
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [month, setMonth] = useState(String(now.month));
  const [year, setYear] = useState(String(now.year));
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'cash' | 'upi' | 'split'>('cash');
  const [cash, setCash] = useState('');
  const [upi, setUpi] = useState('');
  const [date, setDate] = useState(businessDate());
  const [dateOpen, setDateOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingHouseholds, setLoadingHouseholds] = useState(true);
  const [error, setError] = useState('');
  const submitLock = useRef(false);
  const duplicateRequest = useRef(0);
  const [duplicateCheck, setDuplicateCheck] = useState<{
    key: string;
    status: 'checking' | 'ready' | 'error';
    existing?: DuplicatePayment | null;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<{ items: Household[] }>('/api/households?status=active&limit=500')
      .then((result) => {
        if (active) setHouseholds(result.items);
      })
      .catch((cause: unknown) => {
        if (active) setError(messageOf(cause));
      })
      .finally(() => {
        if (active) setLoadingHouseholds(false);
      });
    return () => { active = false; };
  }, []);

  const filteredHouseholds = households.filter((household) => {
    const query = search.trim().toLowerCase();
    return !query || `${household.house_no} ${household.name}`.toLowerCase().includes(query);
  });

  const refreshDuplicate = useCallback(async (householdId: number, paymentMonth: number, paymentYear: number) => {
    const key = `${householdId}:${paymentMonth}:${paymentYear}`;
    const requestId = ++duplicateRequest.current;
    setDuplicateCheck({ key, status: 'checking' });
    try {
      const result = await checkExistingPayment(householdId, paymentMonth, paymentYear);
      if (requestId === duplicateRequest.current) {
        setDuplicateCheck({ key, status: 'ready', existing: result.existing });
      }
      return result.existing;
    } catch (cause) {
      if (requestId === duplicateRequest.current) {
        setDuplicateCheck({ key, status: 'error', error: messageOf(cause) });
      }
      throw cause;
    }
  }, []);

  useEffect(() => {
    const paymentMonth = Number(month);
    const paymentYear = Number(year);
    if (
      !selected
      || !Number.isInteger(paymentMonth)
      || paymentMonth < 1
      || paymentMonth > 12
      || !Number.isInteger(paymentYear)
      || paymentYear < 2000
      || paymentYear > 2100
      || paymentYear < 2000
      || paymentYear > 2100
    ) {
      return;
    }

    const timer = setTimeout(() => {
      void refreshDuplicate(selected.id, paymentMonth, paymentYear).catch((_cause: unknown) => {});
    }, 0);
    return () => {
      clearTimeout(timer);
      duplicateRequest.current += 1;
    };
  }, [selected, month, year, refreshDuplicate]);

  const currentDuplicateKey = selected
    && Number.isInteger(Number(month))
    && Number(month) >= 1
    && Number(month) <= 12
    && Number.isInteger(Number(year))
    && Number(year) >= 2000
    && Number(year) <= 2100
    ? `${selected.id}:${Number(month)}:${Number(year)}`
    : null;
  const currentDuplicateCheck = duplicateCheck?.key === currentDuplicateKey ? duplicateCheck : null;

  const submit = async (force = false) => {
    if (!selected) {
      setError('Choose a household first.');
      return;
    }
    const paymentMonth = Number(month);
    const paymentYear = Number(year);
    if (
      !Number.isInteger(paymentMonth)
      || paymentMonth < 1
      || paymentMonth > 12
      || !Number.isInteger(paymentYear)
      || paymentYear < 2000
      || paymentYear > 2100
    ) {
      setError('Enter a valid payment month and year.');
      return;
    }
    if (!isSelectablePaymentDate(date)) {
      setError('Choose today or an earlier payment date in the Asia/Kolkata time zone.');
      return;
    }
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError('');
    try {
      await refreshDuplicate(selected.id, paymentMonth, paymentYear);
    } catch (cause) {
      setError(`Could not verify whether this household has already paid. No payment was submitted. ${messageOf(cause)}`);
      submitLock.current = false;
      setBusy(false);
      return;
    }
    const body = {
      household_id: selected.id,
      month: paymentMonth,
      year: paymentYear,
      amount,
      payment_mode: mode,
      ...(mode === 'split' ? { cash_amount: cash, upi_amount: upi } : {}),
      payment_date: date,
      upi_reference: reference,
      notes,
      ...(force ? { force: true } : {}),
    };
    try {
      const result = await apiSend<{ payment: Payment }>('/api/payments', 'POST', body);
      if (!result.payment?.id) {
        throw new Error('The server did not confirm the saved payment.');
      }
      onPaymentRecorded();
      Alert.alert('Collection saved', `${formatInrFromPaise(result.payment.amount)} recorded for ${selected.house_no}.`);
      setAmount('');
      setCash('');
      setUpi('');
      setReference('');
      setNotes('');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const duplicate = duplicateFromError(cause);
        const existingDetails = duplicate
          ? ` Existing payment: ${formatInrFromPaise(duplicate.amount_paise)} · ${paymentMode(duplicate.payment_mode)} · ${dateLabel(duplicate.payment_date)}.`
          : '';
        Alert.alert(
          'Payment already recorded',
          `${cause.message}${existingDetails} Do you want to record this as an additional entry?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Record another', onPress: () => { void submit(true); } },
          ],
        );
      } else if (cause instanceof ApiError) {
        setError(cause.status >= 500
          ? `The server could not confirm whether the payment was saved: ${cause.message} Check the household’s payment history before retrying.`
          : messageOf(cause));
      } else {
        setError(`Could not confirm whether the payment was saved: ${messageOf(cause)} Check the household’s payment history before retrying.`);
      }
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={(
        <Button
          label="Save collection"
          onPress={() => { void submit(); }}
          busy={busy}
          disabled={!selected || !amount}
        />
      )}
    >
      <Heading title="Add collection" subtitle="Record this household’s monthly contribution." />
      {error ? <Notice>{error}</Notice> : null}
      <Card>
        <SectionTitle>Household</SectionTitle>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPickerOpen(true)}
          style={[styles.select, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <Text numberOfLines={1} style={[styles.selectLabel, { color: selected ? colors.text : colors.muted }]}>
            {selected ? `${selected.house_no} · ${selected.name}` : 'Choose a household'}
          </Text>
          <Text style={{ color: colors.green, fontWeight: '700' }}>{selected ? 'Change' : 'Choose'}</Text>
        </Pressable>
        {selected ? <Text style={{ color: colors.muted }}>Monthly amount · {formatInrFromPaise(selected.monthly_amount)}</Text> : null}
        {currentDuplicateCheck?.status === 'checking' ? (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>
            Checking payment history for this month…
          </Text>
        ) : null}
        {currentDuplicateCheck?.status === 'ready' && currentDuplicateCheck.existing ? (
          <Notice tone="info">
            {`Payment already recorded for ${selected?.house_no} in ${month}/${year}. Existing payment: ${formatInrFromPaise(currentDuplicateCheck.existing.amount_paise)} · ${paymentMode(currentDuplicateCheck.existing.payment_mode)} · ${dateLabel(currentDuplicateCheck.existing.payment_date)}.`}
          </Notice>
        ) : null}
        {currentDuplicateCheck?.status === 'error' ? (
          <View style={styles.duplicateError}>
            <Notice>{`Could not check this household’s payment history. ${currentDuplicateCheck.error ?? 'Check your connection and try again.'}`}</Notice>
            <Button
              label="Retry payment check"
              variant="secondary"
              onPress={() => {
                if (selected) {
                  void refreshDuplicate(selected.id, Number(month), Number(year)).catch((_cause: unknown) => {});
                }
              }}
            />
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Collection details</SectionTitle>
        <View style={styles.splitRow}>
          <Field
            label="Month (1–12)"
            value={month}
            onChangeText={setMonth}
            keyboardType="number-pad"
            accessibilityLabel="Payment month"
            containerStyle={styles.halfField}
          />
          <Field
            label="Year"
            value={year}
            onChangeText={setYear}
            keyboardType="number-pad"
            accessibilityLabel="Payment year"
            containerStyle={styles.halfField}
          />
        </View>
        <Field
          label="Total amount (₹)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="e.g. 500"
          accessibilityLabel="Total amount in rupees"
          style={styles.amountInput}
        />
      </Card>

      <Card>
        <SectionTitle>Payment method</SectionTitle>
        <ChoiceRow
          value={mode}
          onChange={setMode}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'upi', label: 'UPI' },
            { value: 'split', label: 'Split' },
          ]}
        />
        {mode === 'split' ? (
          <View style={styles.splitRow}>
            <Field label="Cash (₹)" value={cash} onChangeText={setCash} keyboardType="decimal-pad" containerStyle={styles.halfField} />
            <Field label="UPI (₹)" value={upi} onChangeText={setUpi} keyboardType="decimal-pad" containerStyle={styles.halfField} />
          </View>
        ) : null}
        <Text style={[styles.label, { color: colors.muted }]}>Payment date</Text>
        {Platform.OS === 'web' ? (
          React.createElement('input', {
            type: 'date',
            value: date,
            max: businessDate(),
            'aria-label': 'Payment date',
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              const nextDate = (event.currentTarget as { value: string }).value;
              if (isSelectablePaymentDate(nextDate)) setDate(nextDate);
            },
            style: {
              width: '100%',
              boxSizing: 'border-box',
              minHeight: 48,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: colors.border,
              borderRadius: 8,
              backgroundColor: colors.surface,
              color: colors.text,
              padding: '0 12px',
              fontFamily: 'IBMPlexSans_400Regular',
              fontSize: 16,
              outlineColor: colors.gold,
            },
          })
        ) : (
          <>
            <Button label={dateLabel(date)} variant="secondary" onPress={() => setDateOpen(true)} />
            {dateOpen ? (
              <DateTimePicker
                value={parseCalendarDate(date) ?? parseCalendarDate(businessDate()) ?? new Date()}
                mode="date"
                display="default"
                maximumDate={parseCalendarDate(businessDate()) ?? new Date()}
                onChange={(_event, picked) => {
                  setDateOpen(false);
                  if (picked) {
                    const nextDate = calendarDateString(picked);
                    if (isSelectablePaymentDate(nextDate)) setDate(nextDate);
                  }
                }}
              />
            ) : null}
          </>
        )}
        {mode !== 'cash' ? (
          <Field
            label="UPI reference (optional)"
            value={reference}
            onChangeText={setReference}
            placeholder="Transaction reference"
            autoCapitalize="characters"
            accessibilityLabel="UPI reference"
          />
        ) : null}
        <Field
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Add a note"
          multiline
          numberOfLines={3}
          accessibilityLabel="Payment notes"
        />
      </Card>
      <Modal visible={pickerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={[styles.modalSafe, { backgroundColor: colors.background }]}>
          <GridBackdrop />
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Choose household</Text>
            <Button label="Done" variant="plain" onPress={() => setPickerOpen(false)} />
          </View>
          <View style={styles.modalSearch}>
            <Field label="Search" value={search} onChangeText={setSearch} placeholder="House number or name" />
          </View>
          {loadingHouseholds ? <LoadingState label="Loading households…" /> : null}
          <FlatList
            data={filteredHouseholds}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Keyboard.dismiss();
                  setSelected(item);
                  setPickerOpen(false);
                  setSearch('');
                }}
                style={[styles.householdRow, { borderBottomColor: colors.border }]}
              >
                <View style={styles.grow}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{item.house_no} · {item.name}</Text>
                  <Text style={{ color: colors.muted }}>Monthly {formatInrFromPaise(item.monthly_amount)}</Text>
                </View>
                <Text style={{ color: colors.green, fontWeight: '700' }}>Select</Text>
              </Pressable>
            )}
            ListEmptyComponent={!loadingHouseholds ? <Text style={{ color: colors.muted, padding: 20 }}>No matching active households.</Text> : undefined}
          />
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

interface HouseholdDraft {
  id?: number;
  house_no: string;
  name: string;
  phone: string;
  monthly_amount: string;
  status: 'active' | 'inactive';
}

const emptyHousehold: HouseholdDraft = {
  house_no: '',
  name: '',
  phone: '',
  monthly_amount: '',
  status: 'active',
};

export function HouseholdsScreen({ refreshKey }: { refreshKey: number }) {
  const colors = usePalette();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<Household[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<HouseholdDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<number | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [receiptBusyId, setReceiptBusyId] = useState<number | null>(null);
  const [documentRequest, setDocumentRequest] = useState<DocumentRequest | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState('');

  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams({ status, limit: '500' });
    if (search.trim()) params.set('search', search.trim());
    return apiGet<{ items: Household[] }>(`/api/households?${params.toString()}`);
  }, [search, status]);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setItems((await fetchItems()).items);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [fetchItems]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      setBusy(true);
      try {
        const result = await fetchItems();
        if (!active) return;
        setItems(result.items);
        if (active) setError('');
      } catch (cause) {
        if (active) setError(messageOf(cause));
      } finally {
        if (active) setBusy(false);
      }
    };
    void refresh();
    return () => { active = false; };
  }, [fetchItems, refreshKey]);

  useEffect(() => {
    if (selectedHouseholdId === null) return;
    let active = true;
    setDetailBusy(true);
    setDetailError('');
    apiGet<HouseholdDetail>(`/api/households/${selectedHouseholdId}`)
      .then((result) => { if (active) setDetail(result); })
      .catch((cause) => { if (active) setDetailError(messageOf(cause)); })
      .finally(() => { if (active) setDetailBusy(false); });
    return () => { active = false; };
  }, [selectedHouseholdId, refreshKey]);

  const openDetail = (household: Household) => {
    if (selectedHouseholdId === household.id) return;
    Keyboard.dismiss();
    setDetail(null);
    setDetailError('');
    setDocumentError('');
    setDetailBusy(true);
    setSelectedHouseholdId(household.id);
  };

  const closeDetail = () => {
    if (documentBusy) return;
    if (documentRequest) {
      setDocumentRequest(null);
      setDocumentError('');
      return;
    }
    if (receiptBusyId !== null) return;
    setSelectedHouseholdId(null);
    setDetail(null);
  };

  const prepareReceipt = async (paymentId: number) => {
    setReceiptBusyId(paymentId);
    setDocumentError('');
    try {
      const { payment } = await apiGet<{ payment: Payment }>(`/api/payments/${paymentId}`);
      setDocumentRequest({
        title: receiptPdfTitle(payment),
        html: buildReceiptHtml(payment),
      });
    } catch (cause) {
      setDocumentError(messageOf(cause));
    } finally {
      setReceiptBusyId(null);
    }
  };

  const runDocumentAction = async (action: PdfAction) => {
    if (!documentRequest) return;
    setDocumentBusy(true);
    setDocumentError('');
    try {
      const result = await deliverPdf(documentRequest.html, documentRequest.title, action);
      if (!result.completed) {
        setDocumentError('Save cancelled. The PDF was not saved.');
        return;
      }
      if (action === 'save' && Platform.OS === 'android') {
        Alert.alert('PDF saved', `The document was saved as ${result.fileName}.`);
      }
      setDocumentRequest(null);
    } catch (cause) {
      setDocumentError(messageOf(cause));
    } finally {
      setDocumentBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    const body = {
      house_no: draft.house_no,
      name: draft.name,
      phone: draft.phone,
      monthly_amount: draft.monthly_amount,
      status: draft.status,
    };
    try {
      await apiSend(
        draft.id ? `/api/households/${draft.id}` : '/api/households',
        draft.id ? 'PUT' : 'POST',
        body,
      );
      setDraft(null);
      await load();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (household: Household) => {
    setSelectedHouseholdId(null);
    setDetail(null);
    setDraft({
      id: household.id,
      house_no: household.house_no,
      name: household.name,
      phone: household.phone || '',
      monthly_amount: String(household.monthly_amount / 100),
      status: household.status,
    });
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <GridBackdrop />
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.content,
          {
            width: '100%',
            maxWidth: 680,
            alignSelf: 'center',
            paddingHorizontal: width < 360 ? 16 : 20,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshing={busy}
        onRefresh={() => { void load(); }}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Heading title="Households" subtitle={`${items.length} shown · manage residents and monthly amounts`} />
            {error ? <Notice>{error}</Notice> : null}
            <Field
              label="Search"
              value={search}
              onChangeText={(value) => { setBusy(true); setSearch(value); }}
              placeholder="House number or resident"
              returnKeyType="search"
              onSubmitEditing={() => { void load(); }}
              accessibilityLabel="Search households"
            />
            <ChoiceRow
              value={status}
              onChange={(value) => { setBusy(true); setStatus(value); }}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Button label="Add household" onPress={() => setDraft({ ...emptyHousehold })} />
            <SectionTitle>Residents</SectionTitle>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.house_no}, ${item.name}`}
            onPress={() => openDetail(item)}
          >
            <Card style={styles.householdCard}>
              <View style={styles.splitRow}>
                <View style={styles.grow}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{item.house_no} · {item.name}</Text>
                  <Text style={{ color: colors.muted }}>{item.status === 'active' ? 'Active household' : 'Inactive household'}</Text>
                </View>
                <Text style={[styles.amount, { color: colors.greenText }]}>{formatInrFromPaise(item.monthly_amount)}</Text>
              </View>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={!busy ? (
          <Card>
            <Text style={[styles.rowTitle, { color: colors.text }]}>No households found</Text>
            <Text style={{ color: colors.muted }}>Try another search or add a household to get started.</Text>
          </Card>
        ) : undefined}
      />

      <Modal visible={Boolean(draft)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDraft(null)}>
        <SafeAreaView style={[styles.modalSafe, { backgroundColor: colors.background }]}>
          <GridBackdrop />
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{draft?.id ? 'Edit household' : 'Add household'}</Text>
            <Button label="Cancel" variant="plain" onPress={() => setDraft(null)} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {error ? <Notice>{error}</Notice> : null}
            <Card>
              <Field
                label="House number"
                value={draft?.house_no || ''}
                onChangeText={(value) => setDraft((current) => current ? { ...current, house_no: value } : current)}
                placeholder="e.g. A-101"
                autoCapitalize="characters"
              />
              <Field
                label="Resident name"
                value={draft?.name || ''}
                onChangeText={(value) => setDraft((current) => current ? { ...current, name: value } : current)}
                placeholder="Full name"
                autoCapitalize="words"
              />
              <Field
                label="Phone (optional)"
                value={draft?.phone || ''}
                onChangeText={(value) => setDraft((current) => current ? { ...current, phone: value } : current)}
                keyboardType="phone-pad"
              />
              <Field
                label="Monthly chanda (₹)"
                value={draft?.monthly_amount || ''}
                onChangeText={(value) => setDraft((current) => current ? { ...current, monthly_amount: value } : current)}
                keyboardType="decimal-pad"
              />
              <Text style={[styles.label, { color: colors.muted }]}>Status</Text>
              <ChoiceRow
                value={draft?.status || 'active'}
                onChange={(value) => setDraft((current) => current ? { ...current, status: value } : current)}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                ]}
              />
              <Button
                label={draft?.id ? 'Save changes' : 'Add household'}
                onPress={() => { void save(); }}
                busy={saving}
                disabled={!draft?.house_no.trim() || !draft?.name.trim() || !draft?.monthly_amount.trim()}
              />
            </Card>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={selectedHouseholdId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeDetail}>
        <SafeAreaView style={[styles.modalSafe, { backgroundColor: colors.background }]}>
          <GridBackdrop />
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Household details</Text>
            <Button label="Done" variant="plain" onPress={closeDetail} disabled={receiptBusyId !== null} />
          </View>
          {detailBusy ? <LoadingState label="Loading household history…" /> : null}
          {detailError ? <Notice>{detailError}</Notice> : null}
          {detail ? (
            <ScrollView contentContainerStyle={styles.modalContent}>
              {documentError ? <Notice>{documentError}</Notice> : null}
              <Heading title={`${detail.household.house_no} · ${detail.household.name}`} subtitle={detail.household.phone || 'No phone number'} />
              <View style={styles.metrics}>
                <Metric label="Monthly amount" value={formatInrFromPaise(detail.household.monthly_amount)} />
                <Metric label="Paid months" value={String(detail.summary.months_paid)} />
                <Metric label="Pending months" value={String(detail.summary.months_pending)} />
                <Metric label="Total collected" value={formatInrFromPaise(detail.summary.total_amount_paise)} />
              </View>
              <Button label="Edit household" variant="secondary" onPress={() => startEdit(detail.household)} disabled={receiptBusyId !== null} />
              <Button
                label="Generate account statement"
                variant="secondary"
                disabled={receiptBusyId !== null}
                onPress={() => {
                  setDocumentError('');
                  setDocumentRequest({
                    title: `Household statement ${detail.household.house_no}`,
                    html: buildHouseholdStatementHtml(detail),
                  });
                }}
              />
              <SectionTitle>Payment history</SectionTitle>
              {detail.payments.length ? detail.payments.map((payment) => (
                <Card key={payment.id}>
                  <View style={styles.splitRow}>
                    <View style={styles.grow}>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>{payment.month}/{payment.year} · {paymentMode(payment.payment_mode)}</Text>
                      <Text style={{ color: colors.muted }}>{dateLabel(payment.payment_date)}</Text>
                    </View>
                    <Text style={[styles.amount, { color: colors.greenText }]}>{formatInrFromPaise(payment.amount)}</Text>
                  </View>
                  <Button
                    label="Receipt PDF options"
                    variant="secondary"
                    onPress={() => { void prepareReceipt(payment.id); }}
                    busy={receiptBusyId === payment.id}
                    disabled={receiptBusyId !== null}
                  />
                </Card>
              )) : <Text style={{ color: colors.muted }}>No payments recorded for this household yet.</Text>}
            </ScrollView>
          ) : null}
          <DocumentActionSheet
            inline
            visible={Boolean(documentRequest)}
            title={documentRequest?.title || 'Document actions'}
            busy={documentBusy}
            error={documentError}
            onClose={closeDetail}
            onAction={(action) => { void runDocumentAction(action); }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

export function ReportsScreen({ refreshKey }: { refreshKey: number }) {
  const colors = usePalette();
  const current = useMemo(() => businessMonth(), []);
  const [type, setType] = useState<'monthly' | 'annual'>('monthly');
  const [mode, setMode] = useState<'all' | 'cash' | 'upi'>('all');
  const [month, setMonth] = useState(String(current.month));
  const [year, setYear] = useState(String(current.year));
  const [report, setReport] = useState<MonthlyReport | AnnualReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadedQuery, setLoadedQuery] = useState('');
  const [reportQuery, setReportQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const [documentRequest, setDocumentRequest] = useState<DocumentRequest | null>(null);
  const [documentError, setDocumentError] = useState('');

  const yearValue = Number(year);
  const monthValue = Number(month);
  const validationError = !Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2100
    ? 'Enter a year from 2000 to 2100.'
    : type === 'monthly' && (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12)
      ? 'Month must be between 1 and 12.'
      : '';
  const query = type === 'annual'
    ? `type=annual&year=${yearValue}&mode=${mode}`
    : `type=monthly&month=${monthValue}&year=${yearValue}&mode=${mode}`;
  const currentQuery = useRef(query);
  useEffect(() => {
    currentQuery.current = query;
  }, [query]);

  const load = useCallback(async () => {
    if (validationError) return;
    setBusy(true);
    setError('');
    setReportQuery('');
    setLoadedQuery('');
    try {
      setReport(await apiGet<MonthlyReport | AnnualReport>(`/api/reports/data?${query}`));
      setReportQuery(query);
      setLoadedQuery(query);
    } catch (cause) {
      setError(messageOf(cause));
      setLoadedQuery(query);
    } finally {
      setBusy(false);
    }
  }, [query, validationError]);

  useEffect(() => {
    if (validationError) return;
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setBusy(true);
        setError('');
        setReportQuery('');
        setLoadedQuery('');
        return apiGet<MonthlyReport | AnnualReport>(`/api/reports/data?${query}`);
      })
      .then((result) => {
        if (!result) return;
        if (active) {
          setReport(result);
          setReportQuery(query);
          setError('');
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(messageOf(cause));
      })
      .finally(() => {
        if (active) {
          setLoadedQuery(query);
          setBusy(false);
        }
      });
    return () => { active = false; };
  }, [query, refreshKey, validationError]);

  const reportBusy = !validationError && (busy || loadedQuery !== query);
  const prepareReportDocument = async () => {
    if (!report || reportQuery !== query) return;
    setExporting(true);
    setDocumentError('');
    try {
      let monthlyReports: MonthlyReport[] = [];
      if (report.type === 'annual') {
        monthlyReports = await Promise.all(
          Array.from({ length: 12 }, (_value, index) => {
            const params = new URLSearchParams({
              type: 'monthly',
              month: String(index + 1),
              year: String(report.year),
              mode: report.mode,
            });
            return apiGet<MonthlyReport>(`/api/reports/data?${params.toString()}`);
          }),
        );
        if (!reconcileAnnualMonthlyReports(report, monthlyReports)) {
          throw new Error('Monthly details did not reconcile with the annual report. Refresh and try again.');
        }
      }
      if (currentQuery.current !== query) {
        throw new Error('The report selection changed. Refresh the report before creating its PDF.');
      }
      setDocumentRequest({
        title: reportPdfTitle(report),
        html: buildReportHtml(report, monthlyReports),
      });
    } catch (cause) {
      setDocumentError(messageOf(cause));
    } finally {
      setExporting(false);
    }
  };

  const runDocumentAction = async (action: PdfAction) => {
    if (!documentRequest) return;
    setExporting(true);
    setDocumentError('');
    try {
      const result = await deliverPdf(documentRequest.html, documentRequest.title, action);
      if (!result.completed) {
        setDocumentError('Save cancelled. The PDF was not saved.');
        return;
      }
      if (action === 'save' && Platform.OS === 'android') {
        Alert.alert('PDF saved', `The report was saved as ${result.fileName}.`);
      }
      setDocumentRequest(null);
    } catch (cause) {
      setDocumentError(messageOf(cause));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen>
      <Heading title="Reports" subtitle="Review monthly and annual collections." />
      {validationError || error || documentError ? <Notice>{validationError || error || documentError}</Notice> : null}
      <Card>
        <Text style={[styles.label, { color: colors.muted }]}>Report period</Text>
        <ChoiceRow
          value={type}
          onChange={setType}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'annual', label: 'Annual' },
          ]}
        />
        <View style={styles.splitRow}>
          {type === 'monthly' ? (
            <Field label="Month (1–12)" value={month} onChangeText={setMonth} keyboardType="number-pad" containerStyle={styles.halfField} />
          ) : null}
          <Field label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" containerStyle={styles.halfField} />
        </View>
        <Text style={[styles.label, { color: colors.muted }]}>Payment method</Text>
        <ChoiceRow
          value={mode}
          onChange={setMode}
          options={[
            { value: 'all', label: 'All' },
            { value: 'cash', label: 'Cash' },
            { value: 'upi', label: 'UPI' },
          ]}
        />
        <Button label="Update report" onPress={() => { void load(); }} busy={reportBusy} />
      </Card>
      {reportBusy && loadedQuery !== query ? <LoadingState label="Preparing report…" /> : null}
      {report && reportQuery === query && !validationError && !reportBusy ? (
        <>
          <Heading title={report.label} subtitle={`Payment method: ${report.mode.toUpperCase()}`} />
          <Button
            label={Platform.OS === 'web' ? 'Print / save report PDF' : 'Report PDF options'}
            variant="secondary"
            onPress={() => { void prepareReportDocument(); }}
            busy={exporting}
          />
          <View style={styles.metrics}>
            <Metric label="Total collection" value={formatInrFromPaise(report.summary.total_collection_paise)} />
            <Metric label="Transactions" value={String(report.summary.transactions)} />
            <Metric label="Cash" value={formatInrFromPaise(report.summary.cash_paise)} />
            <Metric label="UPI" value={formatInrFromPaise(report.summary.upi_paise)} />
          </View>
          {report.type === 'monthly' ? (
            <>
              <Card>
                <SectionTitle>Households</SectionTitle>
                <Text style={{ color: colors.muted }}>
                  {report.summary.households_paid} paid · {report.summary.households_pending} pending · {report.summary.active_households} active
                </Text>
                <Text style={{ color: colors.muted }}>Expected pending: {formatInrFromPaise(report.summary.expected_pending_paise)}</Text>
              </Card>
              <SectionTitle>Payments</SectionTitle>
              {report.rows.length ? report.rows.map((payment) => (
                <Card key={payment.id}>
                  <View style={styles.splitRow}>
                    <View style={styles.grow}>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>{payment.house_no} · {payment.household_name}</Text>
                      <Text style={{ color: colors.muted }}>{dateLabel(payment.payment_date)} · {paymentMode(payment.payment_mode)}</Text>
                    </View>
                    <Text style={[styles.amount, { color: colors.greenText }]}>{formatInrFromPaise(reportPaymentAmount(payment, report.mode))}</Text>
                  </View>
                  {payment.payment_mode === 'split' ? (
                    <Text style={{ color: colors.muted }}>Cash {formatInrFromPaise(payment.cash_amount)} · UPI {formatInrFromPaise(payment.upi_amount)}</Text>
                  ) : null}
                </Card>
              )) : <Card><Text style={{ color: colors.muted }}>No payments in this period.</Text></Card>}
              <SectionTitle>Pending households</SectionTitle>
              {report.pending.length ? report.pending.map((household) => (
                <Card key={household.household_id}>
                  <View style={styles.splitRow}>
                    <Text style={[styles.rowTitle, { color: colors.text }]}>{household.house_no} · {household.household_name}</Text>
                    <Text style={{ color: colors.muted }}>{formatInrFromPaise(household.monthly_amount)}</Text>
                  </View>
                </Card>
              )) : <Card><Text style={{ color: colors.muted }}>No pending households.</Text></Card>}
            </>
          ) : (
            <>
              <SectionTitle>Monthly breakdown</SectionTitle>
              {report.monthly.map((entry) => (
                <Card key={entry.month}>
                  <View style={styles.splitRow}>
                    <View style={styles.grow}>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>{entry.month_name}</Text>
                      <Text style={{ color: colors.muted }}>{entry.households_paid} households · {entry.transactions} payments</Text>
                    </View>
                    <Text style={[styles.amount, { color: colors.greenText }]}>{formatInrFromPaise(entry.total_paise)}</Text>
                  </View>
                </Card>
              ))}
              <SectionTitle>Household totals</SectionTitle>
              {report.households.map((household) => (
                <Card key={household.id}>
                  <View style={styles.splitRow}>
                    <View style={styles.grow}>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>{household.house_no} · {household.name}</Text>
                      <Text style={{ color: colors.muted }}>{household.months_paid} months paid</Text>
                    </View>
                    <Text style={[styles.amount, { color: colors.greenText }]}>{formatInrFromPaise(household.total_paise)}</Text>
                  </View>
                </Card>
              ))}
            </>
          )}
          <Text style={{ color: colors.muted }}>
            Future dates are unavailable. Payment dates use Asia/Kolkata.
          </Text>
        </>
      ) : null}
      <DocumentActionSheet
        visible={Boolean(documentRequest)}
        title={documentRequest?.title || 'Document actions'}
        busy={exporting}
        error={documentError}
        onClose={() => setDocumentRequest(null)}
        onAction={(action) => { void runDocumentAction(action); }}
      />
    </Screen>
  );
}

export function SettingsScreen({
  user,
  onUserUpdated,
  onSignOut,
}: {
  user: User;
  onUserUpdated: (user: User) => void;
  onSignOut: () => void;
}) {
  const colors = usePalette();
  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [server, setServer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getServerUrl().then((url) => setServer(url || '')).catch((cause) => setError(messageOf(cause)));
  }, []);

  const saveProfile = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await apiSend<{ user: User }>('/api/settings/profile', 'PUT', { name });
      onUserUpdated(result.user);
      Alert.alert('Profile updated', 'Your name has been saved.');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if ([...newPassword].length < 15) {
      setError('Your new password must be at least 15 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiSend('/api/settings/password', 'PUT', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Password changed', 'Your other active sessions have been signed out.');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await signOut();
    } catch {
      const { clearSession } = await import('./api');
      await clearSession();
    } finally {
      setBusy(false);
      onSignOut();
    }
  };

  return (
    <Screen>
      <Heading title="Settings" subtitle="Your account and device connection." />
      {error ? <Notice>{error}</Notice> : null}
      <Card>
        <SectionTitle>Account</SectionTitle>
        <Text style={{ color: colors.muted }}>{user.email} · {user.role}</Text>
        <Field label="Display name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Button label="Save profile" variant="secondary" onPress={() => { void saveProfile(); }} busy={busy} disabled={!name.trim()} />
      </Card>
      <Card>
        <SectionTitle>Change password</SectionTitle>
        <Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
        <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <Field label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
        <Button label="Update password" variant="secondary" onPress={() => { void changePassword(); }} busy={busy} disabled={!currentPassword || !newPassword || !confirmPassword} />
      </Card>
      <Card>
        <SectionTitle>Connected server</SectionTitle>
        <Text selectable style={{ color: colors.muted }}>{server || 'Not configured'}</Text>
        <Button label="Sign out" variant="danger" onPress={() => { void logout(); }} busy={busy} />
      </Card>
      <Text style={{ color: colors.muted, textAlign: 'center', fontSize: 13 }}>
        Chanda Manager · Secure session · Data stays on your organization’s server
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingTop: 16, paddingBottom: 32, gap: 16 },
  listHeader: { gap: 12, marginBottom: 8 },
  loginRoot: { flex: 1 },
  loginKeyboard: { flex: 1 },
  loginContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 28, gap: 24 },
  loginBrand: { alignItems: 'center', gap: 16 },
  brandLockup: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandLockupCentered: { justifyContent: 'center' },
  brandIconSmall: { width: 34, height: 34, borderRadius: 6, borderCurve: 'continuous' },
  brandName: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 12, letterSpacing: 1.1 },
  brandSlash: { width: 15, height: 2, transform: [{ rotate: '-45deg' }] },
  loginFootnote: { fontFamily: 'IBMPlexSans_400Regular', fontSize: 13, textAlign: 'center' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flexBasis: '47%', flexGrow: 1, minWidth: 0, minHeight: 88, justifyContent: 'space-between' },
  metricLabel: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 12, letterSpacing: 0.3 },
  metricValue: { fontFamily: 'IBMPlexMono_500Medium', fontSize: 19, fontVariant: ['tabular-nums'] },
  collectionHero: { padding: 18, gap: 14, borderRadius: 8, borderCurve: 'continuous' },
  heroLabel: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  heroAmount: { fontFamily: 'IBMPlexMono_500Medium', fontSize: 32, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  summarySplit: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 12 },
  summaryCell: { flex: 1, gap: 4 },
  summaryCellTrailing: { borderLeftWidth: StyleSheet.hairlineWidth, paddingLeft: 14 },
  summaryLabel: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 11, letterSpacing: 0.45 },
  summaryValue: { fontFamily: 'IBMPlexMono_500Medium', fontSize: 15, fontVariant: ['tabular-nums'] },
  summaryStatus: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paymentRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  houseCode: { width: 56, fontFamily: 'IBMPlexMono_500Medium', fontSize: 12, fontVariant: ['tabular-nums'] },
  splitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  rowTitle: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 15, flexShrink: 1 },
  amount: { fontFamily: 'IBMPlexMono_500Medium', fontSize: 14, fontVariant: ['tabular-nums'] },
  label: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  halfField: { flex: 1, minWidth: 0 },
  amountInput: { fontFamily: 'IBMPlexMono_500Medium', fontSize: 24, fontVariant: ['tabular-nums'] },
  selectLabel: { flex: 1, minWidth: 0, fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 15 },
  select: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    borderCurve: 'continuous',
  },
  modalSafe: { flex: 1 },
  modalHeader: {
    minHeight: 60,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 18 },
  modalSearch: { paddingHorizontal: 20, paddingTop: 16 },
  modalContent: { padding: 20, paddingBottom: 32, gap: 16 },
  listContent: { paddingHorizontal: 20, paddingBottom: 32 },
  householdRow: {
    minHeight: 68,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  householdCard: { paddingVertical: 14 },
  duplicateError: { gap: 8 },
});
