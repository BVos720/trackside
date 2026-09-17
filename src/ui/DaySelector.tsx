import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from './Typography';
import { HIT_SIZE, radius, space, useTheme } from './theme';

/** A scrolling date strip that keeps full-size targets on narrow panels. */
export default function DaySelector({ dates, selectedDate, onSelect, label, eventDates = [] }: {
  dates: readonly string[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  label: (date: string) => string;
  eventDates?: readonly string[];
}) {
  const { color } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {dates.map((date) => {
        const selected = date === selectedDate;
        const eventDay = eventDates.includes(date);
        return (
          <Pressable
            key={date}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label(date)}${eventDay ? ', event day' : ''}`}
            onPress={() => onSelect(date)}
            style={({ pressed }) => [styles.day, {
              backgroundColor: selected ? color.accent : color.surfaceRaised,
              borderColor: selected || eventDay ? color.accent : color.border,
              opacity: pressed ? 0.7 : 1,
            }]}
          >
            <Text style={[styles.label, { color: selected ? color.onAccent : color.text }]}>{label(date)}</Text>
            {eventDay && <Text style={[styles.caption, { color: selected ? color.onAccent : color.textMuted }]}>EVENT</Text>}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: space.sm, paddingVertical: space.sm },
  day: { minHeight: HIT_SIZE, minWidth: 88, paddingHorizontal: space.md, paddingVertical: space.sm, borderWidth: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  label: { fontSize: 13, fontWeight: '700' },
  caption: { fontSize: 10, letterSpacing: 1.2 },
});
