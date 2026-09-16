import { StyleSheet, View } from 'react-native';
import { Text } from './Typography';
import { space, useTheme } from './theme';

export default function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  const { color } = useTheme();
  return <View style={styles.root}>
    <View style={styles.eyebrowRow}><View style={[styles.marker, { backgroundColor: color.accent }]} /><Text style={[styles.eyebrow, { color: color.textMuted }]}>{eyebrow.toUpperCase()}</Text></View>
    <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>{title}</Text>
    {description && <Text style={[styles.description, { color: color.textMuted }]}>{description}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  root: { marginTop: space.lg, marginBottom: space.lg },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  marker: { width: 18, height: 3, borderRadius: 2 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  title: { fontSize: 42, fontWeight: '700', lineHeight: 46, marginTop: 10 },
  description: { fontSize: 14, lineHeight: 22, marginTop: 10, maxWidth: 540 },
});
