import { Text } from './Typography';
/**
 * A section that folds away.
 *
 * The event page grew into one long scroll — timetable, import controls, manual
 * entry, plan, backup, delete — and at a circuit you want exactly one of those
 * at a time. Folding the rest is the difference between a page you scan and a
 * page you scroll.
 *
 * ── Closed by default, on purpose ──────────────────────────────────────────
 * The caller can open one, but the default is shut. A screen that opens with
 * everything expanded is the thing being fixed, and the header carries a count
 * so a closed section still tells you whether it has anything in it — which is
 * usually the only question.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radius, space, type, useTheme, weight, type Theme } from './theme';
import { Entrance } from './Motion';

export default function Collapsible({
  title,
  /** Shown on the right of the header. A count, or a short status. */
  badge,
  /** One line under the title while closed, so a shut section still informs. */
  hint,
  initiallyOpen = false,
  children,
}: {
  title: string;
  badge?: string | number | null;
  hint?: string | null;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
          {!open && hint ? (
            <Text style={styles.hint} numberOfLines={1}>
              {hint}
            </Text>
          ) : null}
        </View>
        {badge !== null && badge !== undefined && badge !== '' ? (
          <Text style={styles.badge}>{badge}</Text>
        ) : null}
        <Text style={styles.chevron}>{open ? '−' : '+'}</Text>
      </Pressable>

      {open && <Entrance style={styles.body}>{children}</Entrance>}
    </View>
  );
}

/**
 * Built per-render from the current theme rather than once at import — see
 * `MainMenu.tsx`'s `makeStyles` and theme.ts's `ThemeProvider` doc comment.
 */
function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    root: {
      marginTop: 12,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
      overflow: 'hidden',
    },
    pressed: { opacity: 0.7 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      // Gloves are the normal operating condition (§5.14).
      minHeight: 76,
      paddingVertical: 14,
      paddingHorizontal: space.md,
    },
    chevron: { color: color.textMuted, fontSize: 20, width: 24, textAlign: 'center' },
    titleBlock: { flex: 1 },
    title: { color: color.text, fontSize: type.body, fontWeight: weight.bold },
    hint: { color: color.textMuted, fontSize: 12, lineHeight: 18, marginTop: 5 },
    badge: {
      color: color.accent,
      fontSize: 12,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
    },
    body: {
      paddingHorizontal: space.md,
      paddingBottom: space.md,
      borderTopWidth: 1,
      borderTopColor: color.border,
      paddingTop: space.md,
    },
  });
}
