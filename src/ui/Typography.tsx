import { forwardRef } from 'react';
import { Text as NativeText, TextInput as NativeInput, StyleSheet, type TextProps, type TextInputProps } from 'react-native';
import { isLoaded } from 'expo-font';

/** Explicit font faces keep Android, iOS and web metrics consistent. */
export const Text = forwardRef<NativeText, TextProps>(function Text({ style, ...props }, ref) {
  const flat = StyleSheet.flatten(style) ?? {};
  const bold = flat.fontWeight === 'bold' || Number(flat.fontWeight) >= 600;
  const face = (flat.fontSize ?? 16) >= 24 ? 'TracksideDisplay' : bold ? 'TracksideBold' : 'TracksideRegular';
  return <NativeText ref={ref} {...props} style={[{ fontSize: 16 }, style, !flat.fontFamily && isLoaded(face) && { fontFamily: face, fontWeight: 'normal' }]} />;
});

export const TextInput = forwardRef<NativeInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <NativeInput ref={ref} {...props} style={[isLoaded('TracksideRegular') && { fontFamily: 'TracksideRegular' }, style]} />;
});
