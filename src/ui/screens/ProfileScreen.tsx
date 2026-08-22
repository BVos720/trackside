/**
 * Profile — "kind of like an account, but you don't have to make an account."
 *
 * No sign-in, no email, no password. This screen is a face on the identity
 * that already exists: `LOCAL_USER_ID` (`ui/state/useSpots.ts`) is already
 * attached to every spot, note and media row this app has ever written, so
 * the profile is that same id, not a second one — see
 * `storage-local/preferences.ts`'s `getProfileName`/`setProfileName`.
 *
 * Three sections, in the order they get used: Appearance, Performance, Gear.
 * Gear is the one with real content, and deliberately does not sit third on a
 * screen that scrolls out of view — it is last only because it is being built
 * concurrently elsewhere (see below), not because it matters least.
 *
 * ── Scaffold only ───────────────────────────────────────────────────────────
 * Appearance (theme/accent) and Gear (the gear list) are being built by other
 * agents against this same shell — this file owns section order and the
 * placeholders, not their contents. Follows `CircuitScreen.tsx`'s shape for a
 * top-level, non-event-scoped screen (`useSafeAreaInsets` + `MENU_CLEARANCE`)
 * and `EventScreen.tsx`'s use of `Collapsible` for named sections.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Collapsible from '../Collapsible';
import { MENU_CLEARANCE, color, radius, space, type, weight } from '../theme';

export default function ProfileScreen({
  displayName,
  onChangeDisplayName,
}: {
  /** Null means unnamed — see `setProfileName`. */
  displayName: string | null;
  onChangeDisplayName: (name: string | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(displayName ?? '');

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed !== (displayName ?? '')) onChangeDisplayName(trimmed);
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + MENU_CLEARANCE },
      ]}
    >
      <Text style={styles.kicker}>PROFILE</Text>
      <Text style={styles.title}>Local, not an account</Text>
      <Text style={styles.subtitle}>
        Nothing here leaves this device. There is no sign-in — just settings
        for how the app looks and behaves, and the gear you shoot with.
      </Text>

      <Text style={styles.label}>NAME</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder="Optional — shown nowhere but here"
        placeholderTextColor={color.textFaint}
        style={styles.input}
        returnKeyType="done"
      />

      <Collapsible
        title="Appearance"
        hint="Light, dark, and an accent colour"
        initiallyOpen
      >
        <Text style={styles.placeholder}>
          Nothing yet — theme and accent colour are coming here.
        </Text>
      </Collapsible>

      <Collapsible
        title="Performance"
        hint="Map detail, for slower devices"
      >
        <Text style={styles.placeholder}>
          Nothing yet — map detail toggles are coming here.
        </Text>
      </Collapsible>

      <Collapsible
        title="Gear"
        hint="Bodies and lenses, for the event dropdown"
      >
        <Text style={styles.placeholder}>
          Nothing yet — add a body or lens here once gear is built.
        </Text>
      </Collapsible>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { padding: space.md, paddingBottom: space.xxl },
  pressed: { opacity: 0.7 },

  kicker: {
    color: color.accent,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 2,
  },
  title: {
    color: color.text,
    fontSize: type.title,
    fontWeight: weight.bold,
    marginTop: space.xs,
  },
  subtitle: {
    color: color.textMuted,
    fontSize: type.label,
    lineHeight: 17,
    marginTop: space.xs,
    marginBottom: space.md,
  },

  label: {
    color: color.textFaint,
    fontSize: type.label,
    fontWeight: weight.bold,
    letterSpacing: 1.5,
  },
  input: {
    marginTop: space.sm,
    marginBottom: space.md,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: color.text,
    fontSize: type.body,
    minHeight: 44,
  },

  placeholder: {
    color: color.textFaint,
    fontSize: type.label,
    lineHeight: 17,
  },
});
