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
import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
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
import { color, radius, space, type, weight } from '../theme';

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
  { key: 'detail', title: 'Detail', hint: 'Settings, notes and pictures' },
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
  onSave,
  onCancel,
  onPickPhoto,
  onRemovePhoto,
}: {
  spot: Spot | null;
  draftPosition: { latitude: number; longitude: number } | null;
  media: Media[];
  mediaUris: Record<string, string>;
  onSave: (draft: SpotDraft) => void;
  onCancel: () => void;
  /** `isKey` marks the portfolio hero shot rather than a reference image. */
  onPickPhoto: (kind: ReferenceKind | null, isKey: boolean) => void;
  onRemovePhoto: (id: string) => void;
}) {
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

  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />

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

        {spot === null ? (
          <Text style={styles.help}>
            Save the spot first to attach photos.
          </Text>
        ) : (
          <>
            <Text style={styles.label}>KEY PICTURE</Text>
            <Text style={styles.help}>
              Your best shot from here. This is what shows on the map.
            </Text>
            <Pressable
              onPress={() => onPickPhoto(null, true)}
              style={({ pressed }) => [styles.keySlot, pressed && styles.pressed]}
            >
              {keyUri ? (
                <Image source={{ uri: keyUri }} style={styles.keyImage} />
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
                      <Image source={{ uri }} style={styles.thumbImage} />
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
            {references.length > 0 && (
              <Text style={styles.help}>Long-press a photo to remove it.</Text>
            )}
          </>
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
    </View>
  );
}

const styles = StyleSheet.create({
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
