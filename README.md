# Piano practice

A quiet, offline-first piano trainer. React + TypeScript + Vite, with Spotify Basic Pitch running locally in a Web Worker. Audio is never uploaded, stored, or sent to an API.

Project terminology, musical notation and interface-copy rules are documented in [AGENT.md](AGENT.md); [AGENTS.md](AGENTS.md) points coding agents to those rules.

## Run

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open the printed localhost URL. Microphone access requires HTTPS or localhost. Use an acoustic piano or an acoustic/grand piano patch on a digital piano, without pedal. A microphone must be able to hear the instrument; headphones alone do not feed audio into this app.

Settings include a clearly labelled **Demo / on-screen keys** input for checking the interface without microphone access. It is separate from actual microphone recognition.

## Practice

- Chords, one-octave ascending scales/arpeggios, and three-chord sequences.
- Random roots or movement by fourths/fifths; exact MIDI pitches including octave.
- Left, right, or both hands. Both hands must play each scale step together.
- Root position, first inversion, and open voicing with the bass in the great octave. Scales/arpeggios use their starting octave rather than chord voicing.
- Chord playing style: together, one note at a time ascending, or alternate the two styles between exercises. The task states the resolved style. Sequential chords retain the actual voicing, add no octave tonic, and require exactly one note at each step (including when using both hands). This also applies to each chord of a three-chord sequence. Saved exercises preserve their style.
- Mood-based suggested collections and basic/extended harmonies. Emotional labels are associations, not a universal classification.
- The default beginner level uses only major/minor triads, including when a mood is selected. Suspended, diminished, and augmented triads have their own opt-in level. Chord symbols have a plain-language Russian/English name below them (for example, `Em` → `Ми минор`). Existing `basic` settings now use this beginner pool.
- Adjustable attempt duration, interval between exercises, automatic advance, pause, skip, and a saved difficult list.
- Expected and recognized key highlights can be disabled independently.
- A separate keyboard switch enables memory practice; live correction text remains available without the keyboard. Highlighted keys use a full fill, note names and note-order numbers (not fingering), with check/cross feedback for recognized notes.
- Russian/English and light/dark toggles. The first visit follows system settings; an explicit choice is saved locally.

Opening settings or hiding the app pauses an active attempt and releases the microphone. Settings take effect when returning via **Practice**. Removing the last saved exercise exits difficult-only mode.

## Scale modes and selectors

For scale exercises, **Mode / scale** explicitly selects Ionian (major), Aeolian (natural minor), Dorian, Phrygian, Lydian, Mixolydian, Locrian, harmonic minor, ascending melodic minor, major/minor pentatonic, minor blues, whole-tone or chromatic. **Random diatonic mode** resolves and saves one of the seven modes per task. **Major or minor / by mood** remains the beginner default. A fixed mode determines the pitches independently of mood and harmony complexity. **Scale tonic** can follow the selected root order or stay on a specific pitch class, useful for comparing parallel modes. Both-hand and octave settings still apply. Saved tasks retain the actual resolved scale; older mood-derived tasks preserve their previous pitch sequence. The scale name appears explicitly below the tonic on the practice screen and in the difficult list.

All application selectors use a shared searchable combobox matching the current theme. Type to filter (including `#`/`b` for accidentals); arrows navigate enabled results, Enter commits, Escape cancels, and Tab continues without committing typed text. Empty searches show an explicit message. Popups use a viewport-aware portal so scrollable settings panels cannot clip the list. The footer retains a fixed reserved height, including its installation control; its author link is centered independently of side content. Development-only status text is omitted.

## Musical notation

Large chord symbols are typeset from separate root, compact accidental and smaller quality/extension parts. Their accessible labels retain ordinary chord text. Musical glyphs use the locally bundled Bravura font (SMuFL); note values, augmentation dots and each rest value have their standard shapes. Half rests include a reference line. This is a rhythm-practice diagram, not a full pitched staff engraver.

Expected note labels follow chord/scale spelling rather than a universal black-key alias: E major uses G-sharp, E-flat minor uses G-flat, and C-sharp major uses E-sharp and B-sharp. MIDI comparison is unchanged; note spelling and written octave are separate from pitch identity. Chord inversions retain the letter spelling while changing registers. Ascending extended arpeggios finish on a tonic above the highest chord tone (for example C-add9 ends C4–E4–G4–D5–C6).

The Russian preset terminology distinguishes **основной вид**, **первое обращение**, and the actual low-bass preset **бас в большой октаве**. Moving only the bass is not described as open spacing of the upper voices. Rhythm statistics explicitly describe duration accuracy through onset intervals rather than pitch intervals or physical key releases. Obsolete prototype copy has been removed from the shared dictionary.

## Flow

The **Flow** header toggle opens a keyboard-first exploration mode. It uses simultaneous chords, a wide keyboard with bounded height (up to 220 px, 170 px on phones) and expected/recognized notes, and the existing hand, octave, mood, harmony, voicing, and root-order choices. There is no attempt deadline. A successful chord flashes for 350 ms and the next task begins on the same microphone stream and capture timeline; recording is not restarted between chords. Pause, skip, and save-to-difficult remain available. Opening settings, switching away from the tab, or exiting Flow releases the microphone; Resume starts it again explicitly. Normal practice preferences are preserved. Flow always shows guidance and advances automatically; its time controls and sequential exercise choices are disabled.

Overlapping model windows and a held previous chord cannot alone complete the following task. A fresh attack, note change, or release must follow the task boundary. This mode follows prompted chords; it does not transcribe arbitrary improvisation. Demo input supports checking the same transitions without a piano.

## Rhythm and metronome

The **Rhythm** header toggle opens a four-bar exercise on C4. Choose 2/4, 3/4, 4/4 or 6/8, 40–180 BPM, quarter/eighth/half notes or mixed values (including dotted quarters in 6/8), and optional rests. Each exercise has one count-in bar. Notes animate over their written duration; individual attacks mark the pattern and report early/on-time/late timing. The on-screen C4 key or Space can be used instead of a microphone. Pitch and physical key-release time are deliberately not graded in this rhythm mode: durations are practiced through spacing between attacks, including rests. Interval accuracy compares consecutive matched attacks with their scheduled spacing.

The metronome can also run alone, without microphone access or a recording deadline. It supports silent animation or synthesized clicks, adjustable volume and eighth-note subdivisions, accents on the first beat, and the secondary pulse in 6/8. BPM in 6/8 means dotted-quarter pulses (two per bar). Capture, clicks and animation share an AudioContext clock; audio clicks are scheduled ahead of time. Microphone attacks are timestamped in a dedicated AudioWorklet rather than after Basic Pitch inference. See the [Web Audio timing model](https://www.w3.org/TR/webaudio/) for sample-clock and scheduling semantics.

Microphone onset detection uses rising energy, not pitch, and can react to other sharp sounds. Play in a quiet room; when audible clicks are enabled, use headphones so they cannot be picked up as piano attacks. Sensitivity, timing tolerance and a manual latency correction are available under Configure. Positive correction subtracts systematic lateness. These controls do not eliminate hardware/input latency or establish an acoustic accuracy benchmark. Synthetic attack/decay/noise tests and metronome scheduling tests are included; live piano/microphone calibration still needs user validation.

Statistics include on-time percentage, mean absolute error in milliseconds, interval accuracy, early/late hits, misses and extras. The percentage includes misses and penalizes extra attacks. Only elapsed notes are graded when stopping an incomplete attempt. The last 20 attempts and rhythm settings are stored locally and history can be cleared. Stop, switching modes/settings, hiding the tab and unmounting release microphone/audio resources. Changing rhythm settings clears the current score, preserving history. The offline cache includes the rhythm worklet.

## Recognition and current limits

The bundled model produces polyphonic note probabilities from overlapping two-second windows. WASM is attempted first; initialization falls back to CPU if a model operation is unsupported. The current browser check uses this CPU fallback. A simultaneous chord must have detected attacks within 180 ms and remain stable across several frames; rolling and holding its notes cannot pass this mode. Sequential chords, scales and arpeggios are checked step by step. A sequence must match each chord in order. Recognition can end an attempt before its timer expires. The onset tolerance and confidence thresholds still need validation on real piano recordings.

Low-confidence/silent input requests a retry. Confident mismatches show missing/extra notes or an octave mismatch. A single-note substitution indicates whether the expected note is higher or lower. The app cannot identify the finger used or reliably classify the instrument. Expected hand assignment is an exercise instruction; a microphone does not verify which physical hand played a note.

The interface distinguishes sound activity from model inference: sound arrival is shown immediately from microphone level, and actual worker jobs show a processing indicator. A stable confident mistake is shown during the attempt without stopping recording, so it can be corrected immediately. Partial attacks receive a longer grace period; uncertain frames do not produce early error verdicts. Result animations respect reduced-motion preferences. Inference still depends on overlapping two-second windows and device speed; the sound activity indicator does not claim the chord has already been identified.

The model has been checked against silence and a synthetic piano-like C-major chord, including transient harmonic artifacts and tensor cleanup. This is **not** an acoustic accuracy benchmark. Phone microphone recordings, real pianos, noisy rooms, fast scales, and low registers still need evaluation and threshold tuning. Note feedback arrives after inference, not instantaneously on every attack. No MIDI input is implemented yet.

## Offline and install

The production service worker caches the full application, font files, model weights, WASM binaries, and audio worklet. Wait for **Offline ready** before disconnecting. The browser can evict local storage; a later online visit will rebuild the cache. The development server intentionally does not register the service worker.

Install through your browser's install action (or Add to Home Screen on iOS). Where available, the app also shows an install button. While online, visible tabs check for updates every minute and when regaining focus or connectivity. Once the new version is fully cached, a “New version available” notice offers an Update button. It stops the current attempt and reloads only after the user clicks; settings and saved difficult exercises remain in local storage. Background/offline tabs check again when resumed. Failed update checks do not interrupt practice.

```sh
BASE_PATH=/piano-trainer/ npm run build
BASE_PATH=/piano-trainer/ npm run preview
```

## GitHub Pages

The repository's origin is `https://github.com/mxmvshnvsk/piano-trainer.git`.
The included workflow checks and builds pull requests, then deploys pushes to `main` with the `/piano-trainer/` base path. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. No server or API secret is required. Workflow setup alone does not mean the app has been deployed.

## Checks

```sh
npm test
npm run build
node scripts/verify-model.mjs
```

Unit tests cover mood pools, voicings, exact octaves, simultaneous chord matching, ordered sequences, low-confidence input, overlapping frames, and corrupt persisted settings. The model check uses bundled weights locally without network access.

Mockup drafts and generated design experiments live in the ignored `output/` directory and are not part of the application or deployment.

## Licenses

Application: MIT. Spotify Basic Pitch and its model: Apache-2.0 (`public/model/LICENSE`). TensorFlow.js: Apache-2.0. Manrope, Cormorant Garamond and Steinberg's Bravura music font: SIL Open Font License (copies in `public/licenses/`). The open-palm silhouette is an original vector drawing; no stock reference image is included.
