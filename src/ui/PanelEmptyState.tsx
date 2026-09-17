import { StyleSheet, View } from 'react-native';
import { Text } from './Typography';
import { radius, space, useTheme } from './theme';

export default function PanelEmptyState({ eyebrow, title, description }: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  const { color } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: color.surfaceRaised, borderColor: color.border }]}>
      <Text style={[styles.eyebrow, { color: color.textMuted }]}>{eyebrow.toUpperCase()}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>{title}</Text>
      <Text style={[styles.description, { color: color.textMuted }]}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md, borderWidth: 1, borderRadius: radius.md, marginVertical: space.sm },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { fontSize: 28, fontWeight: '700', marginTop: space.sm },
  description: { fontSize: 14, lineHeight: 22, marginTop: space.sm },
});
