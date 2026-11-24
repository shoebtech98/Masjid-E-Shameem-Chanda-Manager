import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  grid: string;
  green: string;
  greenText: string;
  gold: string;
  onGold: string;
  onGreenMuted: string;
  danger: string;
  dangerSurface: string;
  onGreen: string;
}

export function usePalette(): Palette {
  const dark = useColorScheme() === 'dark';
  return dark
    ? {
        background: '#101a16',
        surface: '#17231e',
        surfaceAlt: '#213029',
        text: '#f1f5f2',
        muted: '#b2beb7',
        border: '#3a4b41',
        grid: '#25352c',
        green: '#79c99d',
        greenText: '#9bd8b5',
        gold: '#dfbd67',
        onGold: '#203c32',
        onGreenMuted: '#d3e1d8',
        danger: '#ffb4a9',
        dangerSurface: '#3a211f',
        onGreen: '#062519',
      }
    : {
        background: '#f7f7f2',
        surface: '#fffefa',
        surfaceAlt: '#eef1eb',
        text: '#203c32',
        muted: '#52675f',
        border: '#d3ddd6',
        grid: '#dfe4dc',
        green: '#203c32',
        greenText: '#203c32',
        gold: '#c49a45',
        onGold: '#203c32',
        onGreenMuted: '#dce4df',
        danger: '#b42318',
        dangerSurface: '#fef0ee',
        onGreen: '#ffffff',
      };
}

export const GridBackdrop = React.memo(function GridBackdrop() {
  const colors = usePalette();
  const { width, height } = useWindowDimensions();
  const cellSize = 26;
  const originX = 20;
  const originY = 48;
  const verticalCount = Math.ceil((width - originX) / cellSize) + 1;
  const horizontalCount = Math.ceil((height - originY) / cellSize) + 1;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: verticalCount }, (_value, index) => (
        <View
          key={`v-${index}`}
          style={[
            styles.gridVertical,
            { left: originX + index * cellSize, backgroundColor: colors.grid },
          ]}
        />
      ))}
      {Array.from({ length: horizontalCount }, (_value, index) => (
        <View
          key={`h-${index}`}
          style={[
            styles.gridHorizontal,
            { top: originY + index * cellSize, backgroundColor: colors.grid },
          ]}
        />
      ))}
    </View>
  );
});

export function Screen({
  children,
  footer,
}: React.PropsWithChildren<{ footer?: React.ReactNode }>) {
  const colors = usePalette();
  const { width } = useWindowDimensions();
  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <GridBackdrop />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={[
          styles.content,
          {
            width: '100%',
            maxWidth: 680,
            alignSelf: 'center',
            paddingHorizontal: width < 360 ? 16 : 20,
            paddingBottom: footer ? 16 : 32,
          },
        ]}
      >
        {children}
      </ScrollView>
      {footer ? (
        <View
          style={[
            styles.footer,
            {
              paddingHorizontal: width < 360 ? 16 : 20,
              backgroundColor: colors.background,
              borderTopColor: colors.border,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export function Heading({
  title,
  subtitle,
  align = 'left',
}: {
  title: string;
  subtitle?: string;
  align?: 'left' | 'center';
}) {
  const colors = usePalette();
  return (
    <View style={[styles.heading, align === 'center' && styles.headingCentered]}>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }, align === 'center' && styles.textCentered]}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.muted }, align === 'center' && styles.textCentered]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function SectionTitle({ children }: React.PropsWithChildren) {
  const colors = usePalette();
  return <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>{children}</Text>;
}

export function Card({ children, style }: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const colors = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

export function Field({
  label,
  style,
  containerStyle,
  ...props
}: TextInputProps & { label: string; containerStyle?: StyleProp<ViewStyle> }) {
  const colors = usePalette();
  const keyboardAppearance = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel || label}
        keyboardAppearance={keyboardAppearance}
        placeholderTextColor={colors.muted}
        selectionColor={colors.gold}
        style={[
          styles.input,
          { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
          style,
        ]}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  busy = false,
  variant = 'primary',
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'plain';
  accessibilityLabel?: string;
}) {
  const colors = usePalette();
  const fill = variant === 'primary' ? colors.gold
    : variant === 'danger' ? colors.dangerSurface
      : variant === 'secondary' ? colors.surfaceAlt
        : 'transparent';
  const inactive = disabled || busy;
  const foreground = inactive ? colors.muted
    : variant === 'primary' ? colors.onGold
    : variant === 'danger' ? colors.danger
      : colors.text;
  const background = inactive && variant === 'primary' ? colors.surfaceAlt : fill;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: pressed ? 0.82 : 1 },
      ]}
    >
      {busy
        ? <ActivityIndicator color={foreground} />
        : <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>}
      {variant === 'primary' && !busy ? (
        <View style={[styles.buttonSlash, { backgroundColor: foreground }]} />
      ) : null}
    </Pressable>
  );
}

export function ChoiceRow<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const colors = usePalette();
  return (
    <View style={styles.choiceRow}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.choice,
              {
                backgroundColor: selected ? colors.green : colors.surface,
                borderColor: selected ? colors.green : colors.border,
                opacity: pressed ? 0.78 : 1,
              },
            ]}
          >
            <Text style={[styles.choiceText, { color: selected ? colors.onGreen : colors.text }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Notice({ children, tone = 'error' }: React.PropsWithChildren<{ tone?: 'error' | 'info' }>) {
  const colors = usePalette();
  return (
    <View style={[
      styles.notice,
      { backgroundColor: tone === 'error' ? colors.dangerSurface : colors.surfaceAlt },
    ]}>
      <Text style={[styles.bodyText, { color: tone === 'error' ? colors.danger : colors.text }]}>{children}</Text>
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const colors = usePalette();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.green} />
      <Text style={[styles.bodyText, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

export function Divider() {
  const colors = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 12 }} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingTop: 16, paddingBottom: 32, gap: 16 },
  heading: { gap: 6, paddingTop: 4 },
  headingCentered: { alignItems: 'center' },
  textCentered: { textAlign: 'center' },
  title: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 27, letterSpacing: -0.5 },
  subtitle: { fontFamily: 'IBMPlexSans_400Regular', fontSize: 15 },
  sectionTitle: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 14, marginBottom: 2, letterSpacing: 0.6, textTransform: 'uppercase' },
  card: { borderWidth: 1, borderRadius: 8, padding: 16, gap: 12, borderCurve: 'continuous' },
  field: { gap: 6 },
  label: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 12, letterSpacing: 0.3, textTransform: 'uppercase' },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontFamily: 'IBMPlexSans_400Regular',
    fontSize: 16,
    borderCurve: 'continuous',
  },
  button: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderCurve: 'continuous',
  },
  buttonText: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 15, letterSpacing: 0.2 },
  buttonSlash: { position: 'absolute', right: 16, width: 14, height: 2, transform: [{ rotate: '-45deg' }] },
  bodyText: { fontFamily: 'IBMPlexSans_400Regular', fontSize: 14 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  choiceText: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 14 },
  notice: { borderRadius: 6, padding: 12, borderCurve: 'continuous' },
  loading: { padding: 30, alignItems: 'center', justifyContent: 'center', gap: 12 },
  gridVertical: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridHorizontal: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  footer: { paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
