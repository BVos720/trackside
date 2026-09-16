import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SpotUse } from '../core/domain/spot';
import { VENUE_VIEW, type VenueKey } from './map/style';
import { MENU_HEIGHT, MENU_TOP, radius, space, useTheme, type Theme } from './theme';
import { Text } from './Typography';
import { Entrance, useReducedMotion } from './Motion';

export type Destination = 'map' | 'list' | 'times' | 'events' | 'event' | 'plan' | 'circuit' | 'profile';
const ITEMS: { key: Destination; label: string; hint: string; number: string }[] = [
  { key: 'map', label: 'Explore the map', hint: 'Find your next perspective', number: '01' },
  { key: 'events', label: 'Race weekends', hint: 'Timetables, gear and your plan', number: '02' },
  { key: 'circuit', label: 'Circuits', hint: 'Choose your next destination', number: '03' },
  { key: 'profile', label: 'Your paddock', hint: 'Profile, appearance and equipment', number: '04' },
];

export default function MainMenu({ open, onOpenChange, venue, eventName, counts, spotUse, useCounts, onSpotUseChange, current, onNavigate }: {
  open: boolean; onOpenChange: (open: boolean) => void; venue: VenueKey; eventName: string | null;
  counts: { spots: number; sessions: number; events: number; stops: number };
  spotUse: SpotUse; useCounts: Record<SpotUse, number>; onSpotUseChange: (use: SpotUse) => void;
  current?: Destination; onNavigate: (to: Destination) => void;
}) {
  const insets = useSafeAreaInsets();
  const { color } = useTheme();
  const reduced = useReducedMotion();
  const styles = useMemo(() => makeStyles(color), [color]);
  const onMap = current === 'map' || current === 'list';
  const navigate = (destination: Destination) => { onNavigate(destination); onOpenChange(false); };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Open navigation" accessibilityState={{ expanded: open }} onPress={() => onOpenChange(true)}
      style={({ pressed }) => [styles.trigger, { top: insets.top + MENU_TOP }, onMap && styles.triggerOnMap, pressed && styles.pressed]}>
      <View style={[styles.menuIcon, onMap && { backgroundColor: '#26322F' }]}><View style={[styles.menuLine, { backgroundColor: onMap ? '#F4F5F0' : color.text }]} /><View style={[styles.menuLine, { width: 12, backgroundColor: onMap ? '#F4F5F0' : color.text }]} /></View>
      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={1} style={[styles.triggerTitle, onMap && { color: '#F4F5F0' }]}>{VENUE_VIEW[venue].label}</Text>
        <Text numberOfLines={1} style={[styles.triggerSub, onMap && { color: '#B0BBB9' }]}>{eventName ?? 'Your circuit collection'}</Text>
      </View>
    </Pressable>
    <Modal visible={open} transparent animationType={reduced ? 'none' : 'fade'} onRequestClose={() => onOpenChange(false)} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close navigation" style={StyleSheet.absoluteFill} onPress={() => onOpenChange(false)} />
        <Entrance style={[styles.sheet, { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={styles.brandRow}>
            <View style={styles.brand}><View style={styles.brandMark} /><Text style={styles.wordmark}>TRACKSIDE</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close navigation" onPress={() => onOpenChange(false)} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
            <Text style={styles.eyebrow}>YOUR FIELD GUIDE</Text>
            <Text style={styles.headline}>{'Every angle.\nEvery weekend.'}</Text>
            <View style={styles.context}>
              <View style={styles.liveDot} /><View style={{ flex: 1 }}><Text style={styles.contextTitle}>{VENUE_VIEW[venue].label}</Text><Text style={styles.contextSub}>{eventName ?? 'Explore at your own pace'}</Text></View>
            </View>
            <View style={styles.items}>{ITEMS.map(item => {
              const selected = item.key === current || (item.key === 'events' && (current === 'event' || current === 'plan' || current === 'times'));
              return <Pressable key={item.key} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => navigate(item.key)} style={({ pressed }) => [styles.item, selected && styles.itemSelected, pressed && styles.pressed]}>
                <Text style={[styles.itemNumber, selected && { color: color.accent }]}>{item.number}</Text>
                <View style={{ flex: 1 }}><Text style={styles.itemLabel}>{item.label}</Text><Text style={styles.itemHint}>{item.hint}</Text></View>
                <Text style={{ color: selected ? color.accent : color.textFaint, fontSize: 20 }}>↗</Text>
              </Pressable>;
            })}</View>
            {eventName && <Pressable accessibilityRole="button" onPress={() => navigate('event')} style={styles.eventLink}><Text style={styles.eventLinkText}>Back to {eventName}</Text><Text style={{ color: color.accent }}>→</Text></Pressable>}
            <Text style={[styles.eyebrow, { marginTop: 28 }]}>AT THE CIRCUIT FOR</Text>
            <View style={styles.modeRow}>{[{ value: SpotUse.Photography, label: 'Photography' }, { value: SpotUse.Spectating, label: 'Spectating' }].map(option => {
              const selected = spotUse === option.value;
              return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => onSpotUseChange(option.value)} style={({ pressed }) => [styles.mode, selected && styles.modeSelected, pressed && styles.pressed]}><Text style={[styles.modeLabel, selected && { color: color.accent }]}>{option.label}</Text><Text style={styles.modeCount}>{useCounts[option.value]} saved spots</Text></Pressable>;
            })}</View>
            <Text style={styles.footer}>{counts.spots} spots  /  {counts.events} weekends  /  Yours to explore</Text>
          </ScrollView>
        </Entrance>
      </View>
    </Modal>
  </>;
}

function makeStyles(color: Theme['color']) { return StyleSheet.create({
  trigger: { position: 'absolute', left: space.md, height: MENU_HEIGHT, maxWidth: '72%', flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 8, paddingRight: 18, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
  triggerOnMap: { backgroundColor: '#191F22', borderColor: '#354045' },
  menuIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: color.surfaceRaised, justifyContent: 'center', alignItems: 'center', gap: 5 },
  menuLine: { width: 18, height: 2, borderRadius: 2 },
  triggerTitle: { color: color.text, fontSize: 14, fontWeight: '700' },
  triggerSub: { color: color.textMuted, fontSize: 11, marginTop: 3 },
  pressed: { opacity: 0.65 },
  backdrop: { flex: 1, backgroundColor: 'rgba(5,12,10,0.65)', alignItems: 'flex-start' },
  sheet: { width: '92%', maxWidth: 420, flex: 1, backgroundColor: color.background, paddingHorizontal: 24, borderTopRightRadius: 28, borderBottomRightRadius: 28 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 9, height: 25, backgroundColor: color.accent, transform: [{ skewX: '-16deg' }] },
  wordmark: { color: color.text, fontSize: 28, letterSpacing: 2, fontWeight: '700' },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: color.textMuted, fontSize: 24 },
  eyebrow: { fontSize: 10, letterSpacing: 2, color: color.textMuted, fontWeight: '700' },
  headline: { fontSize: 46, lineHeight: 47, color: color.text, fontWeight: '700', marginTop: 12, marginBottom: 24 },
  context: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
  liveDot: { height: 7, width: 7, borderRadius: 4, backgroundColor: color.accent },
  contextTitle: { fontSize: 14, fontWeight: '700', color: color.text },
  contextSub: { fontSize: 12, lineHeight: 18, marginTop: 4, color: color.textMuted },
  items: { marginTop: 24, gap: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 78, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 16 },
  itemSelected: { backgroundColor: color.surfaceRaised },
  itemNumber: { fontSize: 11, color: color.textFaint, fontVariant: ['tabular-nums'] },
  itemLabel: { fontSize: 16, fontWeight: '700', color: color.text },
  itemHint: { fontSize: 11, lineHeight: 17, color: color.textMuted, marginTop: 4 },
  eventLink: { flexDirection: 'row', gap: 8, justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: color.border },
  eventLinkText: { flex: 1, color: color.accent, fontSize: 13 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  mode: { flex: 1, padding: 14, minHeight: 68, justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: color.border },
  modeSelected: { backgroundColor: color.surfaceRaised, borderColor: color.accent },
  modeLabel: { fontSize: 12, fontWeight: '700', color: color.textMuted },
  modeCount: { fontSize: 10, marginTop: 6, color: color.textMuted },
  footer: { color: color.textFaint, fontSize: 10, lineHeight: 16, marginTop: 24 },
}); }
