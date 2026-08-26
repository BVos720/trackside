/**
 * Circuit picker.
 *
 * A dropdown rather than a row of chips: three venues already crowd a phone
 * width, and the list is meant to grow (Zolder, Le Mans). Lives above the
 * platform split so `MapScreen.tsx` and `MapScreen.web.tsx` cannot drift.
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { radius, space, type, useTheme, weight, type Theme } from '../theme';
import { VENUE_VIEW, type VenueKey } from './style';

const VENUES = Object.keys(VENUE_VIEW) as VenueKey[];

export default function VenueSwitcher({
  venue,
  onChange,
}: {
  venue: VenueKey;
  onChange: (v: VenueKey) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const [open, setOpen] = useState(false);
  const current = VENUE_VIEW[venue];

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <View>
          <Text style={styles.triggerLabel}>{current.label}</Text>
          <Text style={styles.triggerSub}>{current.country}</Text>
        </View>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* Tapping the backdrop dismisses — the standard escape from a sheet. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.menu} onPress={() => {}}>
            <Text style={styles.menuTitle}>CIRCUIT</Text>
            <ScrollView>
              {VENUES.map((key) => {
                const v = VENUE_VIEW[key];
                const active = key === venue;
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.item,
                      active && styles.itemActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.itemText}>
                      <Text
                        style={[styles.itemLabel, active && styles.itemLabelActive]}
                      >
                        {v.label}
                      </Text>
                      <Text style={styles.itemSub}>{v.country}</Text>
                    </View>
                    {active && <Text style={styles.tick}>✓</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginHorizontal: space.sm,
      marginBottom: space.sm,
      paddingHorizontal: space.md,
      // Gloves are the normal operating condition (§5.14).
      height: 52,
      borderRadius: radius.md,
      backgroundColor: color.surface,
    },
    pressed: { opacity: 0.7 },
    triggerLabel: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    triggerSub: { color: color.textFaint, fontSize: type.label },
    chevron: { color: color.textMuted, fontSize: 16 },

    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    menu: {
      backgroundColor: color.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: space.md,
      maxHeight: '70%',
    },
    menuTitle: {
      color: color.textFaint,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 2,
      marginBottom: space.sm,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 56,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
      marginBottom: space.sm,
    },
    itemActive: { backgroundColor: color.accent },
    itemText: {},
    itemLabel: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    itemLabelActive: { color: color.onAccent },
    itemSub: { color: color.textFaint, fontSize: type.label },
    tick: { color: color.onAccent, fontSize: 18, fontWeight: weight.bold },
  });
}
