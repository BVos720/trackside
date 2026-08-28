/**
 * A square crop that keeps the right part of the picture — TASKS.md F3.
 *
 * `resizeMode: 'cover'` crops to the middle, and the middle is usually the
 * wrong place: a reference shot is framed around a corner, a fence gap or a
 * marshal post, and a centre crop cuts out the thing that identifies the
 * spot. This honours a stored focal point instead, and optionally lets the
 * viewer tap to move it.
 *
 * The geometry lives in `core/logic/focalCrop.ts` and is tested there. What
 * is here is only the part that needs React: measuring the box, asking the
 * platform how big the image really is, and turning a tap into a coordinate.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  CENTRE,
  focalCrop,
  focalFromTap,
  type FocalPoint,
  type Size,
} from '../core/logic/focalCrop';

export default function FocalImage({
  uri,
  focal,
  onChangeFocal,
  style,
}: {
  uri: string;
  /** Null means nobody has said, which renders as a plain centre crop. */
  focal?: FocalPoint | null;
  /**
   * When given, tapping sets a new focal point.
   *
   * Absent for ordinary display. Passing it is what turns this from a
   * thumbnail into an editor, so a stray tap on a list row can never reframe
   * somebody's photograph.
   */
  onChangeFocal?: (focal: FocalPoint) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    // The platform is the only thing that knows the real dimensions, and it
    // has to read the file to find out. Until it answers, focalCrop returns
    // the box itself and the image simply fills it.
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled) setNatural({ width, height });
      },
      () => {
        // A file that cannot be measured still renders; it just centres.
        if (!cancelled) setNatural({ width: 0, height: 0 });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const point = focal ?? CENTRE;
  const crop = useMemo(
    () => focalCrop(natural, box, point),
    [natural, box, point],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ width, height });
  };

  const content = (
    <View style={[styles.clip, style]} onLayout={onLayout}>
      {box.width > 0 && (
        <Image
          source={{ uri }}
          style={{
            position: 'absolute',
            left: crop.left,
            top: crop.top,
            width: crop.width,
            height: crop.height,
          }}
          /*
            'stretch', not 'cover'.

            The rectangle has already been sized to cover by focalCrop, so
            asking the platform to cover it a second time would crop again —
            inside a box that is deliberately larger than the visible area —
            and undo the offset.
          */
          resizeMode="stretch"
        />
      )}
    </View>
  );

  if (!onChangeFocal) return content;

  return (
    <Pressable
      onPress={(e) =>
        onChangeFocal(
          focalFromTap(
            { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY },
            natural,
            box,
            point,
          ),
        )
      }
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
