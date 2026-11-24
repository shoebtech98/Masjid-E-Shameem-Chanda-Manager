import React from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Heading, usePalette } from './ui';
import type { PdfAction } from './pdf-actions';

export function DocumentActionSheet({
  visible,
  inline = false,
  title,
  busy = false,
  error,
  onClose,
  onAction,
}: {
  visible: boolean;
  inline?: boolean;
  title: string;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onAction: (action: PdfAction) => void;
}) {
  const colors = usePalette();
  const insets = useSafeAreaInsets();

  if (!visible) return null;
  const content = (
    <View style={[styles.backdrop, inline && StyleSheet.absoluteFill]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close document actions"
        style={StyleSheet.absoluteFill}
        onPress={busy ? undefined : onClose}
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            paddingBottom: Math.max(insets.bottom, 16),
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
        ]}
      >
        <Heading title={title} subtitle="Create a PDF from the confirmed server data." />
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
        {Platform.OS === 'web' ? (
          <>
            <Button label="Print PDF" onPress={() => onAction('print')} busy={busy} />
            <Button label="Download PDF" variant="secondary" onPress={() => onAction('download')} busy={busy} />
          </>
        ) : (
          <>
            <Button
              label={Platform.OS === 'ios' ? 'Save to Files' : 'Save PDF to device'}
              onPress={() => onAction('save')}
              busy={busy}
            />
            <Button label="Share PDF" variant="secondary" onPress={() => onAction('share')} busy={busy} />
            <Button label="Print PDF" variant="secondary" onPress={() => onAction('print')} busy={busy} />
            <Text style={[styles.hint, { color: colors.muted }]}>
              On iPhone, choose Save to Files in the share sheet. Android asks you to choose a folder.
            </Text>
          </>
        )}
        <Button label="Cancel" variant="plain" onPress={onClose} disabled={busy} />
      </View>
    </View>
  );
  if (inline) return content;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={busy ? undefined : onClose}
    >
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(16, 26, 22, 0.48)',
  },
  sheet: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    borderWidth: 1,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
  },
  error: {
    fontSize: 13,
    lineHeight: 19,
  },
});
