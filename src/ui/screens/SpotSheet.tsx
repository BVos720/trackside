/**
 * Create / edit a spot — spec §5.1.
 *
 * ── On shooting bearing ────────────────────────────────────────────────────
 * There is deliberately no bearing control here. `Spot.shootingBearing` still
 * exists and still drives the §5.2 backlit / side-lit answer, but §5.1 is clear
 * that it should be captured from the device compass when a reference photo is
 * taken in-app — not typed in. A ±15° stepper was a worse answer than no answer,
 * because a hand-guessed bearing looks identical to a measured one downstream.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  AccessClassification,
  DEFAULT_SPOT_USES,
  SpotUse,
  type ShotSetting,
  type Spot,
  normaliseUses,
} from '../../core/domain/spot';
import { toggleUse } from '../../core/logic/spotUse';
import { type Media, ReferenceKind } from '../../core/domain/media';
import type { SpotDraft } from '../state/useSpots';
import { radius, space, type, useTheme, weight, type Theme } from '../theme';

/**
 * Access classification is chosen, never derived — spec §0.1, §9.1.
 *
 * `unknown` is selected by default and described honestly. Many of the best
 * Nordschleife positions are places people should not be, and a wrong
 * `official` here is an instruction to a stranger to stand somewhere that could
 * get them hurt or the spot fenced off for everyone.
 */
/**
 * What a position can be good for.
 *
 * The hints describe the job, not the place — "somewhere to shoot from" versus
 * "somewhere to watch from" — because the same fence gap can be an excellent
 * answer to one and a poor answer to the other, and the person tagging it is
 * deciding which.
 */
const USE_OPTIONS: { value: SpotUse; label: string; hint: string }[] = [
  {
    value: SpotUse.Photography,
    label: 'Photography',
    hint: 'Somewhere to shoot from',
  },
  {
    value: SpotUse.Spectating,
    label: 'Spectating',
    hint: 'Somewhere to watch from',
  },
];

/**
 * The form, broken into steps.
 *
 * ── Why this is not one long form ─────────────────────────────────────────
 * Marking a spot happens at the side of a circuit, often with cars coming past
 * and usually one-handed. A single scroll of ten labelled sections asks you to
 * assess all of it at once, and the honest result is that everything below the
 * fold gets left empty — so the fields that make a spot *useful later* are
 * exactly the ones that never get filled.
 *
 * Four screens, each answering one question, with a big Next between them.
 * §5.14 wants controls a gloved hand can hit without care, and that is much
 * easier to give four sparse screens than one dense one.
 *
 * ── Save is available from the first step ─────────────────────────────────
 * The steps are not a gate. A spot needs a name and a position to be worth
 * keeping; everything after that is refinement you may well want to do later,
 * in the car, rather than now, in the rain. A wizard that demanded all four
 * screens before it would save anything would be slower than the scroll it
 * replaced, which would defeat the point.
 */
const STEPS: { key: string; title: string; hint: string }[] = [
  { key: 'basics', title: 'What', hint: 'Name, and what it is good for' },
  { key: 'access', title: 'Access', hint: 'Whether you may stand here' },
  { key: 'when', title: 'When', hint: 'Times and what the position is like' },
  { key: 'detail', title: 'Detail', hint: 'Camera settings and notes' },
  { key: 'photos', title: 'Photos', hint: 'Reference shots — where to stand' },
];

const ACCESS_OPTIONS: {
  value: AccessClassification;
  label: string;
  hint: string;
}[] = [
  {
    value: AccessClassification.Unknown,
    label: 'Not documented',
    hint: 'You have not confirmed access here yet.',
  },
  {
    value: AccessClassification.Official,
    label: 'Official',
    hint: 'Inside a ticketed or sanctioned spectator area.',
  },
  {
    value: AccessClassification.PublicLand,
    label: 'Public land',
    hint: 'Publicly accessible, no permission needed.',
  },
  {
    value: AccessClassification.PermissionRequired,
    label: 'Permission needed',
    hint: 'Needs a pass, accreditation or a landowner’s permission.',
  },
];

/**
 * Suggested key-time labels.
 *
 * Suggestions, not a fixed set — the field is free text and the input below
 * accepts anything. These are the ones that come up constantly, so they are one
 * tap rather than typing with cold hands.
 *
 * "Golden hour" and "blue hour" deliberately match the band names the Light
 * screen computes (§5.2), so the two line up when they are eventually joined.
 */
const SUGGESTED_TIMES = [
  'Sunrise',
  'Golden hour',
  'Blue hour',
  'Sundown',
  'Midday',
  'Night',
  'Overcast',
] as const;

/**
 * Suggested position tags.
 *
 * What the position is physically like, as opposed to when it is worth being
 * there. Descriptive only — none of these grant permission to stand anywhere.
 * That is the ACCESS field, which carries its own safety rules (§0.1, §9.1),
 * and "Viewport" must never be read as "you are allowed here".
 */
const SUGGESTED_TAGS = [
  'Viewport',
  'Blocking fence',
  'Debris fence',
  'Armco only',
  'Elevated',
  'Behind barrier',
  'Long lens',
  'Close to track',
] as const;

export default function SpotSheet({
  spot,
  draftPosition,
  media,
  mediaUris,
  pendingPhotos = [],
  onSave,
  onCancel,
  onPickPhoto,
  onRemovePhoto,
}: {
  spot: Spot | null;
  draftPosition: { latitude: number; longitude: number } | null;
  media: Media[];
  mediaUris: Record<string, string>;
  /**
   * Photos picked before the spot exists, held until it is saved.
   *
   * Empty when editing, because those attach immediately — there is already an
   * id to hang them on.
   */
  pendingPhotos?: readonly {
    kind: ReferenceKind | null;
    isKey: boolean;
    previewUri: string | null;
  }[];
  onSave: (draft: SpotDraft) => void;
  onCancel: () => void;
  /** `isKey` marks the portfolio hero shot rather than a reference image. */
  onPickPhoto: (kind: ReferenceKind | null, isKey: boolean) => void;
  onRemovePhoto: (id: string) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(() => makeStyles(color), [color]);

  const position = spot
    ? { latitude: spot.position.latitude, longitude: spot.position.longitude }
    : draftPosition;

  const [name, setName] = useState('');
  const [access, setAccess] = useState<AccessClassification>(
    AccessClassification.Unknown,
  );
  const [notes, setNotes] = useState('');
  const [keyTimes, setKeyTimes] = useState<string[]>([]);
  const [customTime, setCustomTime] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  /**
   * Which step is showing.
   *
   * Editing an existing spot opens on the first step like creating one does,
   * but the step headers are tappable, so fixing one field is a tap rather
   * than a walk through all four.
   */
  const [step, setStep] = useState(0);
  const [uses, setUses] = useState<SpotUse[]>([...DEFAULT_SPOT_USES]);
  /** The use whose untick was just refused, so the reason can be shown. */
  const [blockedUse, setBlockedUse] = useState<SpotUse | null>(null);
  const [shots, setShots] = useState<ShotSetting[]>([]);
  const [draftShot, setDraftShot] = useState({
    technique: '',
    focalMin: '',
    focalMax: '',
    shutter: '',
    aperture: '',
    iso: '',
  });

  useEffect(() => {
    setStep(0);
    setName(spot?.name ?? '');
    setAccess(spot?.accessClassification ?? AccessClassification.Unknown);
    setNotes(spot?.accessNotes ?? '');
    setKeyTimes([...(spot?.keyTimes ?? [])]);
    setCustomTime('');
    setTags([...(spot?.tags ?? [])]);
    setCustomTag('');
    // Through the normaliser: a spot saved before this field existed carries no
    // `uses`, and reading it raw would open the form with nothing ticked.
    setUses(normaliseUses(spot?.uses));
    setBlockedUse(null);
    setShots([...(spot?.shotSettings ?? [])]);
    setDraftShot({
      technique: '',
      focalMin: '',
      focalMax: '',
      shutter: '',
      aperture: '',
      iso: '',
    });
  }, [spot]);

  if (!position) return null;

  const save = () =>
    onSave({
      name,
      latitude: position.latitude,
      longitude: position.longitude,
      // Preserved rather than cleared: a bearing recorded elsewhere must not be
      // wiped just because this form no longer edits it.
      shootingBearing: spot?.shootingBearing ?? null,
      accessClassification: access,
      accessNotes: notes.trim() === '' ? null : notes.trim(),
      keyTimes,
      tags,
      shotSettings: shots,
      uses,
    });

  const toggleTime = (label: string) =>
    setKeyTimes((t) =>
      t.includes(label) ? t.filter((x) => x !== label) : [...t, label],
    );

  const addCustomTime = () => {
    const label = customTime.trim();
    if (label === '') return;
    // Case-insensitive de-dupe: "Golden hour" and "golden hour" are the same
    // tag, and two of them would render as two chips saying the same thing.
    if (!keyTimes.some((t) => t.toLowerCase() === label.toLowerCase())) {
      setKeyTimes((t) => [...t, label]);
    }
    setCustomTime('');
  };

  const toggleTag = (label: string) =>
    setTags((t) =>
      t.includes(label) ? t.filter((x) => x !== label) : [...t, label],
    );

  const addCustomTag = () => {
    const label = customTag.trim();
    if (label === '') return;
    if (!tags.some((t) => t.toLowerCase() === label.toLowerCase())) {
      setTags((t) => [...t, label]);
    }
    setCustomTag('');
  };

  const addShot = () => {
    const d = draftShot;
    const num = (v: string) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    // A row with nothing in it is not worth storing.
    if (
      d.technique.trim() === '' &&
      d.focalMin === '' &&
      d.shutter.trim() === '' &&
      d.aperture.trim() === ''
    ) {
      return;
    }
    const blank = (v: string) => (v.trim() === '' ? null : v.trim());
    setShots((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        technique: d.technique.trim() || 'General',
        focalMinMm: num(d.focalMin),
        focalMaxMm: num(d.focalMax) ?? num(d.focalMin),
        // Full frame. The owner shoots an R6 Mark II; the field exists so the
        // figure can be re-derived if that ever changes (§5.6).
        cropFactorBasis: 1,
        shutter: blank(d.shutter),
        aperture: blank(d.aperture),
        iso: blank(d.iso),
        note: null,
      },
    ]);
    setDraftShot({
      technique: '',
      focalMin: '',
      focalMax: '',
      shutter: '',
      aperture: '',
      iso: '',
    });
  };

  const keyImage = media.find((m) => m.isKeyImage) ?? null;
  const keyUri = keyImage?.storageKey ? mediaUris[keyImage.storageKey] : undefined;
  const references = media.filter((m) => !m.isKeyImage);

  /** Chosen while creating, not yet written — see the Photos step below. */
  const pendingKey = pendingPhotos.find((p) => p.isKey) ?? null;
  const pendingReferences = pendingPhotos.filter((p) => !p.isKey);
  const pendingCount = pendingPhotos.length;

  /**
   * How far the sheet has been dragged down from its resting position.
   *
   * ── Why the grabber was decorative until now ──────────────────────────
   * The bar at the top of this sheet looks exactly like every draggable sheet
   * on the phone, so it was reasonable to expect it to drag — and it did
   * nothing. A control that looks interactive and is not is worse than no
   * control, because you spend the first few tries assuming you did it wrong.
   *
   * ── Built on PanResponder rather than a gesture library ───────────────
   * `react-native-gesture-handler` and Reanimated are not dependencies here,
   * and adding a native module costs a rebuild and a new set of ways for the
   * build to break — which is expensive when signing keys are rationed.
   * PanResponder and Animated ship with React Native and are already used by
   * SkyControl, so this adds no surface at all.
   *
   * ── Down only ─────────────────────────────────────────────────────────
   * Dragging up is clamped to zero. The sheet already sizes itself to its
   * content up to 82% of the screen, so there is nothing above to reveal, and
   * a sheet that can be flung into empty space feels broken rather than
   * flexible.
   */
  const dragY = useRef(new Animated.Value(0)).current;

  const settle = (toValue: number) =>
    Animated.spring(dragY, {
      toValue,
      useNativeDriver: true,
      bounciness: 0,
      speed: 14,
    }).start();

  const drag = useRef(
    PanResponder.create({
      /*
       * Claim the gesture only once it is clearly a vertical drag.
       *
       * Returning true from onStartShouldSet would swallow taps on the
       * grabber's own row. The 6px threshold, and requiring vertical movement
       * to exceed horizontal, keeps a scroll inside the body and a stray
       * finger on a field from being read as a drag on the sheet.
       */
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),

      onPanResponderMove: (_e, g) => {
        dragY.setValue(Math.max(0, g.dy));
      },

      onPanResponderRelease: (_e, g) => {
        /*
         * Dismiss on a decisive gesture, not merely a large one.
         *
         * Either dragged more than 140px, or flung faster than 0.8px/ms —
         * velocity matters because a short sharp flick is how people close
         * these, and requiring distance alone makes the sheet feel sticky.
         */
        if (g.dy > 140 || g.vy > 0.8) {
          onCancel();
          // Reset behind the dismissal so reopening does not start mid-drag.
          dragY.setValue(0);
        } else {
          settle(0);
        }
      },

      // A gesture taken away by the OS (a call, the app backgrounding) must
      // not leave the sheet stranded half-open.
      onPanResponderTerminate: () => settle(0),
    }),
  ).current;

  return (
    /*
      The keyboard must push the sheet, not cover it.

      This sheet is anchored to the bottom of the screen, which is exactly
      where the keyboard appears — so typing a spot name hid the name field
      itself along with Save, and there was no way to scroll to them because
      the sheet had not moved. Reported from the phone as the keyboard sitting
      in front of the menus.

      `padding` on iOS and `height` on Android is the usual split: iOS reports
      the keyboard frame and the view can be inset by it, where Android already
      resizes the window and adding padding on top of that double-counts.
    */
    /*
      The whole sheet moves, not the handle.

      The transform used to sit on a view containing only the grabber, so
      dragging slid a small bar down the screen while the panel it belonged to
      stayed put. Reported exactly that way: it should "slide the whole window
      and not the little stripe".

      The pan handlers stay on the grab area rather than the whole sheet,
      though, and that is deliberate. The body is a ScrollView; claiming
      vertical gestures across all of it would fight scrolling for the same
      finger, and the loser would be whichever the user actually wanted.
    */
    <Animated.View
      style={[styles.sheet, { transform: [{ translateY: dragY }] }]}
    >
      <KeyboardAvoidingView
        style={styles.sheetInner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View {...drag.panHandlers}>
        {/*
          The grab area is deliberately larger than the bar it draws.

          The visible grabber is a few pixels tall, which is nowhere near a
          reliable target for a gloved hand — §5.14. The padding around it is
          part of the control even though nothing is drawn there.
        */}
        <View style={styles.grabArea}>
          <View style={styles.grabber} />
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.kicker}>{spot ? 'EDIT SPOT' : 'NEW SPOT'}</Text>
        <Text style={styles.coords}>
          {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
        </Text>

        {/*
          Where you are in the form, and a way past it.

          Tappable rather than decorative: coming back to add shot settings to a
          spot marked last week should not mean stepping through name and access
          again. It also means the four steps never trap you — every screen is
          one tap from every other.
        */}
        <View style={styles.steps}>
          {STEPS.map((s, i) => {
            const on = i === step;
            return (
              <Pressable
                key={s.key}
                onPress={() => setStep(i)}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.stepChip,
                  on && styles.stepChipOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.stepChipLabel, on && styles.stepChipLabelOn]}>
                  {s.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.stepHint}>{STEPS[step]?.hint}</Text>

        {step === 0 && (
          <>
        <Text style={styles.label}>NAME</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Brünnchen, outside kerb"
          placeholderTextColor={color.textFaint}
          style={styles.input}
        />

        {/*
          What the position is for, which decides which map it shows up on.

          Placed above ACCESS deliberately, and worded to keep the two apart:
          this is about whether the spot is any *good* for something, never
          about whether you are allowed to be there. Ticking "spectating" must
          never read as permission to stand somewhere.
        */}
        <Text style={styles.label}>GOOD FOR</Text>
        <Text style={styles.help}>
          Decides which map this appears on. Both is fine — plenty of positions
          work either way.
        </Text>
        <View style={styles.useRow}>
          {USE_OPTIONS.map((opt) => {
            const on = uses.includes(opt.value);
            // The last remaining tick cannot be removed: a spot that is for
            // nothing shows on neither map and cannot be found again.
            const locked = on && uses.length === 1;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  // Explain the refusal only once it has been attempted.
                  // Showing "needs at least one" on a freshly opened form reads
                  // as a complaint about something the user has not done.
                  if (locked) {
                    setBlockedUse(opt.value);
                    return;
                  }
                  setBlockedUse(null);
                  setUses((u) => toggleUse(u, opt.value, !on));
                }}
                style={({ pressed }) => [
                  styles.use,
                  on && styles.useOn,
                  pressed && !locked && styles.pressed,
                ]}
              >
                <Text style={[styles.useLabel, on && styles.useLabelOn]}>
                  {on ? '✓ ' : ''}
                  {opt.label}
                </Text>
                <Text
                  style={[
                    styles.useHint,
                    blockedUse === opt.value && styles.useHintBlocked,
                  ]}
                >
                  {blockedUse === opt.value
                    ? 'Keep at least one'
                    : opt.hint}
                </Text>
              </Pressable>
            );
          })}
        </View>

          </>
        )}

        {step === 1 && (
          <>
        <Text style={styles.label}>ACCESS</Text>
        <Text style={styles.help}>
          Never guessed. Leave as “not documented” unless you know.
        </Text>
        {ACCESS_OPTIONS.map((opt) => {
          const active = opt.value === access;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setAccess(opt.value)}
              style={({ pressed }) => [
                styles.option,
                active && styles.optionActive,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[styles.optionLabel, active && styles.optionLabelActive]}
              >
                {opt.label}
              </Text>
              <Text style={styles.optionHint}>{opt.hint}</Text>
            </Pressable>
          );
        })}

          </>
        )}

        {step === 2 && (
          <>
        <Text style={styles.label}>KEY TIMES</Text>
        <Text style={styles.help}>
          When this spot is worth being at.
        </Text>
        <View style={styles.chipRow}>
          {SUGGESTED_TIMES.map((label) => {
            const active = keyTimes.includes(label);
            return (
              <Pressable
                key={label}
                onPress={() => toggleTime(label)}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Anything the suggestions do not cover. */}
        {keyTimes.filter((t) => !SUGGESTED_TIMES.includes(t as never)).length > 0 && (
          <View style={styles.chipRow}>
            {keyTimes
              .filter((t) => !SUGGESTED_TIMES.includes(t as never))
              .map((label) => (
                <Pressable
                  key={label}
                  onPress={() => toggleTime(label)}
                  style={({ pressed }) => [
                    styles.chip,
                    styles.chipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipLabel, styles.chipLabelActive]}>
                    {label} ✕
                  </Text>
                </Pressable>
              ))}
          </View>
        )}

        <View style={styles.customRow}>
          <TextInput
            value={customTime}
            onChangeText={setCustomTime}
            onSubmitEditing={addCustomTime}
            placeholder="Add your own…"
            placeholderTextColor={color.textFaint}
            style={[styles.input, styles.customInput]}
          />
          <Pressable
            onPress={addCustomTime}
            style={({ pressed }) => [styles.addChip, pressed && styles.pressed]}
          >
            <Text style={styles.addChipLabel}>Add</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>TAGS</Text>
        <Text style={styles.help}>
          What the position is like. Not permission — that is ACCESS above.
        </Text>
        <View style={styles.chipRow}>
          {SUGGESTED_TAGS.map((label) => {
            const active = tags.includes(label);
            return (
              <Pressable
                key={label}
                onPress={() => toggleTag(label)}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tags.filter((t) => !SUGGESTED_TAGS.includes(t as never)).length > 0 && (
          <View style={styles.chipRow}>
            {tags
              .filter((t) => !SUGGESTED_TAGS.includes(t as never))
              .map((label) => (
                <Pressable
                  key={label}
                  onPress={() => toggleTag(label)}
                  style={({ pressed }) => [
                    styles.chip,
                    styles.chipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipLabel, styles.chipLabelActive]}>
                    {label} ✕
                  </Text>
                </Pressable>
              ))}
          </View>
        )}

        <View style={styles.customRow}>
          <TextInput
            value={customTag}
            onChangeText={setCustomTag}
            onSubmitEditing={addCustomTag}
            placeholder="Add your own…"
            placeholderTextColor={color.textFaint}
            style={[styles.input, styles.customInput]}
          />
          <Pressable
            onPress={addCustomTag}
            style={({ pressed }) => [styles.addChip, pressed && styles.pressed]}
          >
            <Text style={styles.addChipLabel}>Add</Text>
          </Pressable>
        </View>

          </>
        )}

        {step === 3 && (
          <>
        <Text style={styles.label}>SHOT SETTINGS</Text>
        <Text style={styles.help}>
          What works here, per technique. Focal lengths are full-frame
          equivalent so they mean the same on any body.
        </Text>

        {shots.map((sh) => (
          <Pressable
            key={sh.id}
            onLongPress={() => setShots((p) => p.filter((x) => x.id !== sh.id))}
            style={styles.shotRow}
          >
            <Text style={styles.shotTechnique}>{sh.technique}</Text>
            <Text style={styles.shotDetail}>
              {[
                sh.focalMinMm
                  ? sh.focalMaxMm && sh.focalMaxMm !== sh.focalMinMm
                    ? `${sh.focalMinMm}–${sh.focalMaxMm}mm`
                    : `${sh.focalMinMm}mm`
                  : null,
                sh.shutter,
                sh.aperture,
                sh.iso ? `ISO ${sh.iso}` : null,
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>
          </Pressable>
        ))}
        {shots.length > 0 && (
          <Text style={styles.help}>Long-press a row to remove it.</Text>
        )}

        <View style={styles.shotForm}>
          <TextInput
            value={draftShot.technique}
            onChangeText={(v) => setDraftShot((d) => ({ ...d, technique: v }))}
            placeholder="Technique — panning, static, rig…"
            placeholderTextColor={color.textFaint}
            style={styles.input}
          />
          <View style={styles.shotGrid}>
            <TextInput
              value={draftShot.focalMin}
              onChangeText={(v) => setDraftShot((d) => ({ ...d, focalMin: v }))}
              placeholder="100"
              placeholderTextColor={color.textFaint}
              keyboardType="numeric"
              style={[styles.input, styles.shotCell]}
            />
            <TextInput
              value={draftShot.focalMax}
              onChangeText={(v) => setDraftShot((d) => ({ ...d, focalMax: v }))}
              placeholder="500 mm"
              placeholderTextColor={color.textFaint}
              keyboardType="numeric"
              style={[styles.input, styles.shotCell]}
            />
          </View>
          <View style={styles.shotGrid}>
            <TextInput
              value={draftShot.shutter}
              onChangeText={(v) => setDraftShot((d) => ({ ...d, shutter: v }))}
              placeholder="1/125"
              placeholderTextColor={color.textFaint}
              style={[styles.input, styles.shotCell]}
            />
            <TextInput
              value={draftShot.aperture}
              onChangeText={(v) => setDraftShot((d) => ({ ...d, aperture: v }))}
              placeholder="f/5.6"
              placeholderTextColor={color.textFaint}
              style={[styles.input, styles.shotCell]}
            />
            <TextInput
              value={draftShot.iso}
              onChangeText={(v) => setDraftShot((d) => ({ ...d, iso: v }))}
              placeholder="ISO"
              placeholderTextColor={color.textFaint}
              keyboardType="numeric"
              style={[styles.input, styles.shotCell]}
            />
          </View>
          <Pressable
            onPress={addShot}
            style={({ pressed }) => [styles.addChip, pressed && styles.pressed]}
          >
            <Text style={styles.addChipLabel}>+ Add setting</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>NOTES</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Where to stand, fence gaps, where marshals move you on…"
          placeholderTextColor={color.textFaint}
          multiline
          style={[styles.input, styles.inputMulti]}
        />

          </>
        )}

        {/*
          Photos last, and reachable while creating.

          They used to be refused until the spot had been saved, on the honest
          grounds that media attaches to a spot id. But the id is an internal
          detail, and "save, find it again, reopen it, add the picture" is three
          steps to do the thing you were already doing. `pendingPhotos` in
          App.tsx has always held them for exactly this — the sheet simply never
          offered the picker, so the mechanism sat unused.

          Last because it is the step most likely to be skipped in the moment:
          you mark the spot as the cars come past and photograph it afterwards.
          Anything ahead of it would be blocked by a step people walk away from.
        */}
        {step === 4 && (
          <>
            <Text style={styles.label}>KEY PICTURE</Text>
            <Text style={styles.help}>
              Your best shot from here. This is what shows on the map.
            </Text>
            <Pressable
              onPress={() => onPickPhoto(null, true)}
              style={({ pressed }) => [styles.keySlot, pressed && styles.pressed]}
            >
              {keyUri ?? pendingKey?.previewUri ? (
                <Image
                  /*
                    contain, not the default.

                    React Native Images default to cover, which fills the
                    frame by centre-cropping whatever does not fit. A
                    photo cropped in the picker was then cropped again on
                    the way to the screen, around the middle rather than
                    around whatever was framed — reported as the picture
                    being "not centered where i want".

                    A reference photo exists to show one specific thing:
                    the gap in the fence, the post number, which side of
                    the path. Deciding for the photographer which part of
                    that survives is the one thing this must not do. Bars
                    down the sides are a far smaller cost than losing the
                    subject.
                  */
                  resizeMode="contain"
                  source={{ uri: (keyUri ?? pendingKey?.previewUri) as string }}
                  style={styles.keyImage}
                />
              ) : (
                <View style={[styles.keyImage, styles.keyEmpty]}>
                  <Text style={styles.keyEmptyText}>+ Add key picture</Text>
                </View>
              )}
            </Pressable>
            {keyImage && (
              <Pressable onPress={() => onRemovePhoto(keyImage.id)}>
                <Text style={styles.clearLink}>Remove key picture</Text>
              </Pressable>
            )}

            <Text style={styles.label}>WHERE TO STAND</Text>
            <Text style={styles.help}>
              Reference shots, not portfolio shots — the fence line, the gap,
              which side of the path.
            </Text>

            <View style={styles.pickRow}>
              {(
                [
                  [ReferenceKind.Approach, 'Approach'],
                  [ReferenceKind.View, 'View'],
                  [ReferenceKind.Hazard, 'Hazard'],
                ] as const
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  onPress={() => onPickPhoto(value, false)}
                  style={({ pressed }) => [
                    styles.pickBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.pickLabel}>+ {label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.thumbRow}>
              {references.map((m) => {
                const uri = m.storageKey ? mediaUris[m.storageKey] : undefined;
                return (
                  <Pressable
                    key={m.id}
                    onLongPress={() => onRemovePhoto(m.id)}
                    style={styles.thumb}
                  >
                    {uri ? (
                      <Image
                        source={{ uri }}
                        style={styles.thumbImage}
                        resizeMode="contain"
                      />
                    ) : (
                      <View style={[styles.thumbImage, styles.thumbMissing]}>
                        <Text style={styles.thumbMissingText}>no preview</Text>
                      </View>
                    )}
                    <Text style={styles.thumbKind}>
                      {m.referenceKind ?? 'photo'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {/*
              Photos chosen before the spot exists.

              Shown separately and labelled as not yet saved, rather than mixed
              in with the real ones: they are held in memory until the spot is
              created, and presenting them identically would imply they had
              survived something they have not.
            */}
            {pendingReferences.length > 0 && (
              <>
                <View style={styles.thumbRow}>
                  {pendingReferences.map((p, i) => (
                    <View key={`${p.kind ?? 'photo'}-${i}`} style={styles.thumb}>
                      {p.previewUri ? (
                        <Image
                          resizeMode="contain"
                          source={{ uri: p.previewUri }}
                          style={styles.thumbImage}
                        />
                      ) : (
                        <View style={[styles.thumbImage, styles.thumbMissing]}>
                          <Text style={styles.thumbMissingText}>no preview</Text>
                        </View>
                      )}
                      <Text style={styles.thumbKind}>{p.kind ?? 'photo'}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.help}>
                  {pendingCount} photo{pendingCount === 1 ? '' : 's'} will be
                  attached when you save.
                </Text>
              </>
            )}

            {references.length > 0 && (
              <Text style={styles.help}>Long-press a photo to remove it.</Text>
            )}
          </>
        )}
      </ScrollView>

      {/*
        Back, Next and Save together.

        Save sits alongside Next on every step rather than replacing it at the
        end, because the remaining steps are optional and the common case at a
        circuit is "name it now, describe it later". Making Save wait for the
        last screen would turn four quick steps into a four-screen toll on
        dropping a pin.
      */}
      <View style={styles.actions}>
        <Pressable
          onPress={() => (step === 0 ? onCancel() : setStep((s) => s - 1))}
          style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
        >
          <Text style={styles.cancelLabel}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Text>
        </Pressable>

        {step < STEPS.length - 1 && (
          <Pressable
            onPress={() => setStep((s) => s + 1)}
            style={({ pressed }) => [styles.nextBtn, pressed && styles.pressed]}
          >
            <Text style={styles.nextLabel}>Next</Text>
          </Pressable>
        )}

        <Pressable
          onPress={save}
          style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}
        >
          <Text style={styles.saveLabel}>Save</Text>
        </Pressable>
      </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

function makeStyles(color: Theme['color']) {
  return StyleSheet.create({
    /*
     * The inner container carries no position of its own.
     *
     * `sheet` is absolutely positioned and now also animated, so the keyboard
     * avoider inside it just fills what it is given — two positioned ancestors
     * would fight over the same bottom edge.
     */
    sheetInner: { flexShrink: 1 },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '82%',
      backgroundColor: color.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderTopWidth: 1,
      borderColor: color.border,
    },
    grabArea: {
      paddingTop: space.sm,
      paddingBottom: space.sm,
      alignItems: 'center',
    },
    grabber: {
      alignSelf: 'center',
      width: 44,
      height: 4,
      borderRadius: 2,
      backgroundColor: color.border,
      marginTop: space.sm,
    },
    body: { flexGrow: 0 },
    bodyContent: { padding: space.md, paddingBottom: space.lg },
    pressed: { opacity: 0.7 },

    kicker: {
      color: color.accent,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 2,
    },
    coords: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
      fontVariant: ['tabular-nums'],
      marginTop: 2,
    },

    label: {
      color: color.textFaint,
      fontSize: type.label,
      fontWeight: weight.bold,
      letterSpacing: 1.5,
      marginTop: space.lg,
    },
    help: {
      color: color.textMuted,
      fontSize: type.label,
      marginTop: space.xs,
      lineHeight: 17,
    },

    useRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
    /** 64pt: a gloved tap in the rain, per §5.14. */
    use: {
      flex: 1,
      minHeight: 64,
      justifyContent: 'center',
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      borderWidth: 1,
      borderColor: color.border,
    },
    useOn: { borderColor: color.accent, backgroundColor: color.surfaceRaised },
    useLabel: {
      color: color.textMuted,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    useLabelOn: { color: color.text },
    useHint: { color: color.textFaint, fontSize: 11, marginTop: 2 },
    useHintBlocked: { color: color.danger },

    clearLink: {
      color: color.textFaint,
      fontSize: type.label,
      marginTop: space.xs,
    },

    input: {
      marginTop: space.sm,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      color: color.text,
      fontSize: type.body,
      minHeight: 44,
    },
    inputMulti: { minHeight: 88, textAlignVertical: 'top' },

    option: {
      marginTop: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    optionActive: { borderColor: color.accent },
    optionLabel: {
      color: color.textMuted,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    optionLabelActive: { color: color.text },
    optionHint: { color: color.textFaint, fontSize: type.label, marginTop: 2 },

    keySlot: { marginTop: space.sm },
    keyImage: { width: '100%', height: 150, borderRadius: radius.md },
    keyEmpty: {
      backgroundColor: color.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyEmptyText: {
      color: color.textMuted,
      fontSize: type.body,
      fontWeight: weight.bold,
    },

    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      marginTop: space.sm,
    },
    chip: {
      paddingHorizontal: space.md,
      height: 40,
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    chipActive: { backgroundColor: color.accent },
    chipLabel: {
      color: color.textMuted,
      fontSize: type.label,
      fontWeight: weight.bold,
    },
    chipLabelActive: { color: color.onAccent },
    customRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
    customInput: { flex: 1 },
    addChip: {
      height: 44,
      paddingHorizontal: space.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
      marginTop: space.sm,
    },
    addChipLabel: {
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
    },

    shotRow: {
      marginTop: space.sm,
      padding: space.sm,
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    shotTechnique: {
      color: color.text,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    shotDetail: {
      color: color.textMuted,
      fontSize: type.label,
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    shotForm: { marginTop: space.sm },
    shotGrid: { flexDirection: 'row', gap: space.sm },
    shotCell: { flex: 1 },

    pickRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
    pickBtn: {
      flex: 1,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    pickLabel: {
      color: color.text,
      fontSize: type.label,
      fontWeight: weight.bold,
    },

    thumbRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      marginTop: space.sm,
    },
    thumb: { width: 96 },
    thumbImage: { width: 96, height: 72, borderRadius: radius.sm },
    thumbMissing: {
      backgroundColor: color.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbMissingText: { color: color.textFaint, fontSize: 11 },
    thumbKind: {
      color: color.textFaint,
      fontSize: 11,
      marginTop: 2,
      textTransform: 'uppercase',
    },

    actions: {
      flexDirection: 'row',
      gap: space.sm,
      padding: space.md,
      borderTopWidth: 1,
      borderTopColor: color.border,
    },
    cancelBtn: {
      flex: 1,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
    },
    cancelLabel: {
      color: color.textMuted,
      fontSize: type.body,
      fontWeight: weight.bold,
    },
    saveBtn: {
      flex: 1,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.accent,
    },
    saveLabel: { color: color.onAccent, fontSize: type.body, fontWeight: weight.bold },

    /**
     * Next is the expected action, so it is the wide one.
     *
     * Save keeps the accent colour because it is the one that commits, but Next
     * gets the room — on three of the four steps it is what you are reaching for,
     * and the two must not be confusable by a thumb that is not looking.
     */
    nextBtn: {
      flex: 1.4,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: color.surfaceRaised,
      borderWidth: 1,
      borderColor: color.accent,
    },
    nextLabel: { color: color.accent, fontSize: type.body, fontWeight: weight.bold },

    steps: { flexDirection: 'row', gap: 6, marginTop: space.md },
    stepChip: {
      flex: 1,
      minHeight: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: color.surface,
    },
    stepChipOn: { backgroundColor: color.accent },
    stepChipLabel: {
      color: color.textMuted,
      fontSize: 12,
      fontWeight: weight.bold,
    },
    stepChipLabelOn: { color: color.onAccent },
    stepHint: {
      color: color.textFaint,
      fontSize: type.label,
      marginTop: space.xs,
    },
  });
}
