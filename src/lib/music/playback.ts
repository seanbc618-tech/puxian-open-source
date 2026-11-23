import { channelLevel, mixEvent, type MixerChannel } from "./mixer.ts";
import { cleanLoopPause, cleanLoopTimes, fullPasses, loopClock, passStart } from "./loop-pause.ts";
import { TIMBRES, toneEnvelope, type Timbre } from "./timbres.ts";
import { handPlaybackPlan, type PracticeHand, type OtherHand } from "./practice-hands.ts";
import { trainingProgress, type SpeedTraining } from "./speed-training.ts";
import { soundingEvents, type Attack, type Sounding } from "./expression.ts";
import {
  followNoteAt,
  followSlotsAt,
  secondsAt,
  quarterAtSeconds,
  scheduleBeats,
  type BeatClick,
  type FollowSlot,
} from "./playback-clock.ts";
import { resumeRange } from "./practice-text.ts";
import { meterAt } from "./score-timeline.ts";
import { swingWritten, unsWingWritten, SWING_STRAIGHT, clampSwingRatio } from "./swing.ts";
import { accompanimentEvents } from "./comp.ts";
import { scoreWithFermataTempo, scoreWithGradualTempo } from "./fermata.ts";
import type { Score } from "./theory.ts";
import { scoreQuarters } from "./voices.ts";
import {
  clampSpeed,
  playbackSpeed,
  countInClicks,
  practicePass,
  practiceQuarterAt,
  type LoopRange,
  type PracticePass,
} from "./practice.ts";

function swingRatioOf(value: number | undefined): number {
  return value == null ? SWING_STRAIGHT : clampSwingRatio(value);
}

function swungAt(score: Score, at: number, ratio: number): number {
  return swingWritten(at, ratio, meterAt(score, at).beatUnit);
}

function unsWungAt(score: Score, at: number, ratio: number): number {
  return unsWingWritten(at, ratio, meterAt(score, at).beatUnit);
}

/** Audio seconds for a written quarter, with optional swing. Barlines stay on the beat. */
function swungSeconds(score: Score, at: number, ratio: number): number {
  return secondsAt(score, swungAt(score, at, ratio));
}

/** Backing is scheduled on the master bus so voice mute/solo does not drop it. */
function scheduleComp(
  ctx: AudioContext,
  dest: AudioNode,
  score: Score,
  originWhen: number,
  time: (quarter: number) => number,
  from: number,
  to: number,
) {
  for (const event of accompanimentEvents(score, from, to)) {
    tone(
      ctx,
      dest,
      event.midi,
      originWhen + time(event.start),
      Math.max(0.04, time(event.start + event.dur) - time(event.start)),
      event.gain,
      "normal",
      0,
      event.timbre,
    );
  }
}

function tone(
  ctx: AudioContext,
  dest: AudioNode,
  midi: number,
  when: number,
  seconds: number,
  gainScale: number,
  attack: Attack,
  pan = 0,
  timbre: Timbre = "piano",
) {
  const freq = 440 * 2 ** ((midi - 69) / 12);
  if (gainScale <= 0) return;
  const params = TIMBRES[timbre];
  const { partials, levels } = params;
  const envelope = toneEnvelope(timbre, seconds, attack);
  let output = dest;
  const nodes: AudioNode[] = [];
  if (pan && typeof ctx.createStereoPanner === "function") {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, when);
    panner.connect(output);
    nodes.push(panner);
    output = panner;
  }
  if (timbre !== "piano") {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(params.cutoff, when);
    filter.Q.value = .4;
    filter.connect(output);
    nodes.push(filter);
    output = filter;
  }
  let remaining = partials.length;
  partials.forEach((partial, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * partial, when);
    const peak = Math.max(0.0002, levels[index] * gainScale);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + envelope.attack);
    if (envelope.hold > envelope.attack) gain.gain.exponentialRampToValueAtTime(Math.max(.0001, peak * envelope.sustain), when + envelope.hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + envelope.end);
    osc.connect(gain);
    gain.connect(output);
    osc.onended = () => {
      osc.disconnect(); gain.disconnect();
      if (--remaining === 0) nodes.forEach(node => node.disconnect());
    };
    osc.start(when);
    osc.stop(when + envelope.stop);
  });
}

export type PlayFrame = {
  /** 0 at the downbeat, 1 when the longer voice ends. */
  ratio: number;
  /** Voice 1 staff note sounding now. Null in a rest, a staccato gap, or after that voice ends. */
  note: number | null;
  /** Every voice sounding now. Voice 2 does not replace voice 1. */
  slots: FollowSlot[];
  /** Practice count-in: beats left before the music (counts down to 1). */
  countIn?: number;
  /** Practice loop: completed passes so far. */
  pass?: number;
  /** Practice loop pause: seconds of silence left before the next pass. */
  rest?: number;
  /** Practice: score quarter playing now (used to resume after a speed change). */
  position?: number;
};

export type PlaybackPlan = {
  events: Sounding[];
  clicks: BeatClick[];
  /** Longer voice, in quarter notes. The metronome uses this once. */
  quarters: number;
};

/** Shared tempo, one metronome, both voices. Does not touch the audio device. */
export function playbackPlan(score: Score): PlaybackPlan {
  const quarters = scoreQuarters(score);
  return {
    events: soundingEvents(score),
    clicks: scheduleBeats({
      changes: score.changes,
      bpm: score.bpm,
      beats: score.beats,
      beatUnit: score.beatUnit,
      quarters,
    }),
    quarters,
  };
}

export type PlayOptions = {
  mixer?: readonly MixerChannel[];
  /**
   * Eighth-note swing (first eighth as a fraction of the quarter; 0.5 = straight).
   * Compound meters stay even. Metronome clicks stay on the beat.
   */
  swing?: number;
  /** Play a quiet bass + block-chord backing from written chord symbols. */
  comp?: boolean;
  /**
   * Metronome loudness, 0 to 1. Clicks are always scheduled.
   * 0 keeps them silent so the level can rise while this playback is running.
   */
  clickGain?: number;
  hand?: PracticeHand;
  otherHand?: OtherHand;
  /**
   * Practice mode. Omitted (or all defaults) keeps the plain whole-score playback.
   * `speed` re-times the score without changing pitch (the synth is rendered
   * per note); `range` limits to [from, to) quarters; `loop` repeats it until
   * stopped; `countInBars` clicks 1–2 bars first, always audible.
   */
  practice?: {
    range?: LoopRange | null;
    loop?: boolean;
    speed?: number;
    countInBars?: number;
    /** Resume inside the range at this score quarter (rest of the pass first, then full passes). */
    startAt?: number | null;
    /** Plain loop only: seconds of silence after each pass, and passes before stopping (0 = until stopped). */
    loopPause?: number;
    loopTimes?: number;
    training?: { settings: SpeedTraining; completed: number; onProgress: (completed: number) => void };
  };
};

export function isPlainPractice(practice: PlayOptions["practice"]): boolean {
  return !practice || (!practice.training && !practice.range && !practice.loop && clampSpeed(practice.speed ?? 1) === 1 && !(practice.countInBars ?? 0) && practice.startAt == null);
}

export type PlaybackHandle = {
  stop: () => void;
  setClickGain: (gain: number) => void;
  /** Volume / mute / solo apply immediately to scheduled notes; loops pick up the rest next pass. */
  setMixer?: (channels: readonly MixerChannel[]) => void;
};

/**
 * Notes keep the mixer level baked in at scheduling time (so muted voices cost nothing);
 * each voice routes through a trim bus whose gain is live level / baked level.
 * A mixer change starts a new generation so later loop passes bake the new levels.
 */
function liveMixer(ctx: AudioContext, master: AudioNode, initial: readonly MixerChannel[] = []) {
  let channels = initial;
  let generation = 0;
  const buses = new Map<string, { node: GainNode; voice: number; baked: number }>();
  const trim = (voice: number, baked: number) =>
    baked > 0 ? channelLevel(voice, channels) / baked : 0;
  return {
    get channels() {
      return channels;
    },
    to(voice: number): AudioNode {
      const key = `${generation}:${voice}`;
      let bus = buses.get(key);
      if (!bus) {
        const node = ctx.createGain();
        bus = { node, voice, baked: channelLevel(voice, channels) };
        node.gain.value = 1;
        node.connect(master);
        buses.set(key, bus);
      }
      return bus.node;
    },
    set(next: readonly MixerChannel[]) {
      channels = next;
      generation += 1;
      if (ctx.state === "closed") return;
      for (const bus of buses.values())
        bus.node.gain.setTargetAtTime(trim(bus.voice, bus.baked), ctx.currentTime, 0.015);
    },
  };
}

/** Bus level at full volume, before the downbeat / offbeat envelope. */
const CLICK_BUS = 0.16;

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value);
}

function scheduleClick(
  ctx: AudioContext,
  dest: AudioNode,
  when: number,
  level: number,
  accent: boolean,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(accent ? 1760 : 1174.66, when);
  const peak = Math.max(0.0002, level);
  const release = accent ? 0.04 : 0.026;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + release);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(when);
  osc.stop(when + release + 0.02);
}


let sharedPlaybackContext: AudioContext | null = null;

/** Test hook: drop the shared context so each case can start from a closed slate. */
export function resetPlaybackContextForTests(): void {
  const ctx = sharedPlaybackContext;
  sharedPlaybackContext = null;
  if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
}

function acquirePlaybackContext(): AudioContext {
  if (sharedPlaybackContext && sharedPlaybackContext.state !== "closed") return sharedPlaybackContext;
  sharedPlaybackContext = new AudioContext();
  return sharedPlaybackContext;
}

function silenceBus(node: GainNode, ctx: AudioContext): void {
  try {
    node.gain.cancelScheduledValues(ctx.currentTime);
    node.gain.setValueAtTime(0, ctx.currentTime);
  } catch {
    /* already gone */
  }
  try {
    node.disconnect();
  } catch {
    /* already disconnected */
  }
}

/**
 * Kick off resume() in this turn (the user gesture). If the context is
 * already running, schedule immediately so existing callers stay sync.
 * Do not wait only on the resume() promise: some browsers start the
 * context (or fire statechange) without ever settling it, and a rejected
 * resume must not drop the only path to sound.
 */
function afterContextRunning(ctx: AudioContext, cancelled: () => boolean, work: () => void): void {
  let armed = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const run = () => {
    if (armed || cancelled() || ctx.state === "closed" || ctx.state !== "running") return;
    armed = true;
    cleanup();
    work();
  };
  const onState = () => {
    if (ctx.state === "running") run();
  };
  const cleanup = () => {
    ctx.removeEventListener("statechange", onState);
    for (const timer of timers) clearTimeout(timer);
    timers.length = 0;
  };
  ctx.addEventListener("statechange", onState);
  if (ctx.state === "running") {
    run();
    return;
  }
  void Promise.resolve(ctx.resume())
    .then(run)
    .catch(() => {
      onState();
    });
  // If resume() is slow or never settles, keep checking briefly once the
  // browser has flipped the state (some engines skip the promise).
  for (const ms of [0, 16, 50, 100, 250]) {
    timers.push(setTimeout(onState, ms));
  }
}


export function playScore(
  score: Score,
  onProgress: (frame: PlayFrame) => void,
  options?: PlayOptions,
): PlaybackHandle {
  score = scoreWithFermataTempo(scoreWithGradualTempo(score));
  if (!isPlainPractice(options?.practice)) return playPractice(score, onProgress, options ?? {});
  const ctx = acquirePlaybackContext();
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);
  const clickBus = ctx.createGain();
  clickBus.connect(ctx.destination);
  let closed = false;
  let frame = 0;
  let decay: ReturnType<typeof setTimeout> | null = null;
  const mute = () => {
    silenceBus(master, ctx);
    silenceBus(clickBus, ctx);
  };
  const finish = (allowDecay: boolean) => {
    if (closed && !allowDecay) return;
    closed = true;
    cancelAnimationFrame(frame);
    if (decay) {
      clearTimeout(decay);
      decay = null;
    }
    if (allowDecay) {
      decay = setTimeout(mute, 600);
    } else {
      mute();
    }
  };
  const applyClick = (gain: number) => {
    if (closed || ctx.state === "closed") return;
    clickBus.gain.setValueAtTime(CLICK_BUS * clamp01(gain), ctx.currentTime);
  };
  applyClick(options?.clickGain ?? 0);

  const plan = handPlaybackPlan(playbackPlan(score), options?.hand, options?.otherHand);
  const events = plan.events;
  const live = liveMixer(ctx, master, options?.mixer);
  const swing = swingRatioOf(options?.swing);
  afterContextRunning(ctx, () => closed, () => {
    const start = ctx.currentTime + 0.06;
    for (const event of events) {
      const mixed = mixEvent(event, live.channels);
      if (mixed.gain <= 0) continue;
      tone(
        ctx,
        live.to(event.voice),
        event.midi,
        start + swungSeconds(score, event.start, swing),
        Math.max(0.04, swungSeconds(score, event.start + event.dur, swing) - swungSeconds(score, event.start, swing)),
        mixed.gain,
        event.attack,
        mixed.pan,
        mixed.timbre,
      );
    }
    if (options?.comp) {
      scheduleComp(ctx, master, score, start, (q) => swungSeconds(score, q, swing), 0, plan.quarters);
    }
    for (const click of plan.clicks) {
      scheduleClick(ctx, clickBus, start + click.seconds, click.level, click.accent);
    }

    const total = Math.max(0.05, secondsAt(score, plan.quarters));
    const tick = () => {
      if (closed) return;
      const elapsed = ctx.currentTime - start;
      const ratio = elapsed / total;
      const position = unsWungAt(score, quarterAtSeconds(score, elapsed), swing);
      const note = elapsed < 0 || ratio >= 1 ? null : followNoteAt(events, position);
      const slots = elapsed < 0 || ratio >= 1 ? [] : followSlotsAt(events, position);
      onProgress({
        ratio: Math.max(0, Math.min(1, ratio)),
        note,
        slots,
        ...(elapsed >= 0 && ratio < 1 ? { position } : {}),
      });
      if (ratio < 1 && !closed) frame = requestAnimationFrame(tick);
      else if (!closed) {
        // Natural end: let the last notes decay, but keep the shared context alive.
        finish(true);
      }
    };
    frame = requestAnimationFrame(tick);
  });

  return {
    setClickGain: applyClick,
    setMixer: live.set,
    stop: () => {
      if (closed) return;
      finish(false);
      onProgress({ ratio: 0, note: null, slots: [] });
    },
  };
}

/** Retiming only: clicks and pass length stay on the written beat / barline. */
function swingPracticePass(score: Score, range: LoopRange, speed: number, pass: PracticePass, ratio: number): PracticePass {
  const swing = swingRatioOf(ratio);
  if (Math.abs(swing - SWING_STRAIGHT) < 1e-12) return pass;
  const rate = playbackSpeed(speed);
  const origin = secondsAt(score, range.from);
  const time = (q: number) => (swungSeconds(score, q, swing) - origin) / rate;
  return {
    ...pass,
    notes: pass.events.map((event, index) => {
      const note = pass.notes[index];
      return {
        ...note,
        when: time(event.start),
        seconds: Math.max(0.04, time(event.start + event.dur) - time(event.start)),
      };
    }),
  };
}

/** Count-in level: audible even when the metronome is off. */
const COUNT_IN_BUS = 0.14;
/** Schedule the next loop pass this many seconds before it starts. */
const LOOP_LOOKAHEAD = 1.5;

function playPractice(
  score: Score,
  onProgress: (frame: PlayFrame) => void,
  options: PlayOptions,
): PlaybackHandle {
  const practice = options.practice ?? {};
  const ctx = acquirePlaybackContext();
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);
  const clickBus = ctx.createGain();
  clickBus.connect(ctx.destination);
  const countBus = ctx.createGain();
  countBus.gain.value = COUNT_IN_BUS;
  countBus.connect(ctx.destination);
  let closed = false;
  let decay: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;
  const mute = () => {
    silenceBus(master, ctx);
    silenceBus(clickBus, ctx);
    silenceBus(countBus, ctx);
  };
  const finish = (allowDecay: boolean) => {
    if (closed && !allowDecay) return;
    closed = true;
    cancelAnimationFrame(frame);
    if (decay) {
      clearTimeout(decay);
      decay = null;
    }
    if (allowDecay) {
      decay = setTimeout(mute, 600);
    } else {
      mute();
    }
  };
  const applyClick = (gain: number) => {
    if (closed || ctx.state === "closed") return;
    clickBus.gain.setValueAtTime(CLICK_BUS * clamp01(gain), ctx.currentTime);
  };
  applyClick(options.clickGain ?? 0);

  const live = liveMixer(ctx, master, options.mixer);
  const swing = swingRatioOf(options.swing);
  const renderPass = (pass: PracticePass, start: number) => {
    pass.notes.forEach((note, index) => {
      const mixed = mixEvent(pass.events[index], live.channels);
      if (mixed.gain <= 0) return;
      tone(ctx, live.to(pass.events[index].voice), note.midi, start + note.when, note.seconds, mixed.gain, note.attack, mixed.pan, mixed.timbre);
    });
  };
  const renderComp = (start: number, span: LoopRange, speed: number) => {
    if (!options.comp) return;
    const rate = playbackSpeed(speed);
    const origin = secondsAt(score, span.from);
    const time = (q: number) => (swungSeconds(score, q, swing) - origin) / rate;
    scheduleComp(ctx, master, score, start, time, span.from, span.to);
  };
  const plan = handPlaybackPlan(playbackPlan(score), options?.hand, options?.otherHand);
  const whole = { from: 0, to: plan.quarters };
  const asked = practice.range;
  const range =
    asked && asked.to > asked.from && asked.from < plan.quarters
      ? { from: Math.max(0, asked.from), to: Math.min(asked.to, plan.quarters) }
      : whole;
  if (practice.training) {
    const training = practice.training;
    type Segment = { begin: number; music: number; end: number; completed: number; range: LoopRange; speed: number; pass: ReturnType<typeof practicePass>; lead: ReturnType<typeof countInClicks> };
    const queue: Segment[] = [];
    let next = trainingProgress(training.settings, training.completed).completed;
    let nextTime = 0;
    const firstIndex = next;
    let reported = -1;
    const topUp = () => {
      while (!closed && nextTime - ctx.currentTime < LOOP_LOOKAHEAD) {
        const state = trainingProgress(training.settings, next);
        if (state.done) break;
        const partial = next === firstIndex ? resumeRange(range, practice.startAt) : null;
        const segmentRange = partial ?? range;
        const lead = countInClicks(score, range.from, partial ? 0 : (next === firstIndex || training.settings.countEach ? practice.countInBars ?? 0 : 0), state.speed);
        const pass = swingPracticePass(score, segmentRange, state.speed, practicePass(score, plan, segmentRange, state.speed), swing);
        const music = nextTime + lead.length;
        for (const click of lead.clicks) scheduleClick(ctx, countBus, nextTime + click.when, click.level, click.accent);
        renderPass(pass, music);
        renderComp(music, segmentRange, state.speed);
        for (const click of pass.clicks) scheduleClick(ctx, clickBus, music + click.when, click.level, click.accent);
        queue.push({ begin: nextTime, music, end: music + pass.length, completed: next, range: segmentRange, speed: state.speed, pass, lead });
        nextTime = music + pass.length;
        next++;
      }
    };
    const tick = () => {
      if (closed) return;
      topUp();
      while (queue.length && ctx.currentTime >= queue[0].end) queue.shift();
      const current = queue[0];
      if (!current) {
        if (trainingProgress(training.settings, next).done && ctx.currentTime >= nextTime) {
          training.onProgress(next);
          onProgress({ ratio: 1, note: null, slots: [] });
          finish(true);
          return;
        }
      } else {
        if (reported !== current.completed) { reported = current.completed; training.onProgress(reported); }
        const elapsed = ctx.currentTime - current.music;
        if (elapsed < 0) {
          onProgress({ ratio: 0, note: null, slots: [], position: range.from, countIn: current.lead.clicks.length ? Math.max(1, Math.ceil(-elapsed / current.lead.beatSeconds)) : undefined });
        } else {
          const position = unsWungAt(score, practiceQuarterAt(score, current.range, current.speed, elapsed), swing);
          onProgress({ ratio: Math.min(.999999, (position - range.from) / (range.to - range.from)), position, note: followNoteAt(current.pass.events, position), slots: followSlotsAt(current.pass.events, position) });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    afterContextRunning(ctx, () => closed, () => {
      nextTime = ctx.currentTime + 0.06;
      topUp();
      frame = requestAnimationFrame(tick);
    });
    return { setClickGain: applyClick, setMixer: live.set, stop: () => { if (closed) return; finish(false); onProgress({ ratio: 0, note: null, slots: [] }); } };
  }
  const speed = playbackSpeed(practice.speed ?? 1);
  const loop = practice.loop === true;
  const pass = swingPracticePass(score, range, speed, practicePass(score, plan, range, speed), swing);
  // Speed change while playing: finish the current pass from where we were, no count-in.
  const resume = resumeRange(range, practice.startAt);
  const head = resume ? swingPracticePass(score, resume, speed, practicePass(score, plan, resume, speed), swing) : null;
  const headOffset = resume ? (secondsAt(score, resume.from) - secondsAt(score, range.from)) / speed : 0;
  const lead = countInClicks(score, range.from, resume ? 0 : (practice.countInBars ?? 0), speed);
  afterContextRunning(ctx, () => closed, () => {
  const start = ctx.currentTime + 0.06;
  for (const click of lead.clicks) scheduleClick(ctx, countBus, start + click.when, click.level, click.accent);
  const first = start + lead.length;
  // Full passes start after the (optional) partial head.
  const full0 = first + (head ? head.length : 0);
  if (head) {
    renderPass(head, first);
    if (resume) renderComp(first, resume, speed);
    for (const click of head.clicks) scheduleClick(ctx, clickBus, first + click.when, click.level, click.accent);
  }
  const pause = loop ? cleanLoopPause(practice.loopPause) : 0;
  const times = loop ? cleanLoopTimes(practice.loopTimes) : 0;
  const headPasses = head ? 1 : 0;
  const maxFull = fullPasses(times, headPasses);
  let scheduled = 0;
  const schedulePass = () => {
    const t0 = passStart(full0, scheduled, pass.length, pause);
    renderPass(pass, t0);
    renderComp(t0, range, speed);
    for (const click of pass.clicks) scheduleClick(ctx, clickBus, t0 + click.when, click.level, click.accent);
    scheduled += 1;
  };
  if ((!head || loop) && scheduled < maxFull) schedulePass();
  const topUp = () => {
    while (loop && !closed && scheduled < maxFull && passStart(full0, scheduled, pass.length, pause) - ctx.currentTime < LOOP_LOOKAHEAD) schedulePass();
  };
  topUp();

  const tick = () => {
    if (closed) return;
    const elapsed = ctx.currentTime - first;
    if (elapsed < 0) {
      // The 60 ms start-up gap is not a count-in: no "预备" flash without one.
      const left = lead.beatSeconds > 0 ? Math.ceil(-elapsed / lead.beatSeconds - 1e-6) : 0;
      onProgress(lead.clicks.length
        ? { ratio: 0, note: null, slots: [], countIn: Math.max(1, left), pass: 0 }
        : { ratio: headOffset / pass.length, note: null, slots: [], pass: 0 });
      frame = requestAnimationFrame(tick);
      return;
    }
    if (head && resume && elapsed < head.length) {
      const position = unsWungAt(score, practiceQuarterAt(score, resume, speed, elapsed), swing);
      onProgress({
        ratio: Math.max(0, Math.min(1, (headOffset + elapsed) / pass.length)),
        note: followNoteAt(head.events, position),
        slots: followSlotsAt(head.events, position),
        pass: 0,
        position,
      });
      topUp();
      frame = requestAnimationFrame(tick);
      return;
    }
    const sinceFull = ctx.currentTime - full0;
    const clock = loopClock(sinceFull, pass.length, pause, times, headPasses);
    const done = clock.done;
    if ((!loop && (head ? sinceFull >= 0 : done >= 1)) || (loop && (clock.finished || (head && maxFull === 0)))) {
      onProgress({ ratio: 1, note: null, slots: [], pass: 1 });
      finish(true);
      return;
    }
    if (clock.rest > 0) {
      // Silence between passes: nothing sounds and nothing is lit.
      onProgress({ ratio: 0.999999, note: null, slots: [], pass: done + 1 + headPasses, rest: clock.rest });
      topUp();
      frame = requestAnimationFrame(tick);
      return;
    }
    const within = clock.within;
    const position = unsWungAt(score, practiceQuarterAt(score, range, speed, within), swing);
    onProgress({
      ratio: Math.max(0, Math.min(1, within / pass.length)),
      note: followNoteAt(pass.events, position),
      slots: followSlotsAt(pass.events, position),
      pass: done + (head ? 1 : 0),
      position,
    });
    topUp();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  });

  return {
    setClickGain: applyClick,
    setMixer: live.set,
    stop: () => {
      if (closed) return;
      finish(false);
      onProgress({ ratio: 0, note: null, slots: [] });
    },
  };
}

/** Short audition of one pitch on an existing context (tap-to-enter feedback). */
export function previewTone(ctx: AudioContext, midi: number, seconds = 0.35, channels: readonly MixerChannel[] = [], voice = 0) {
  const bus = ctx.createGain();
  bus.gain.value = 0.18;
  bus.connect(ctx.destination);
  const mixed = mixEvent({ voice, gain: 1 }, channels);
  tone(ctx, bus, midi, ctx.currentTime + 0.01, seconds, mixed.gain, "normal", mixed.pan, mixed.timbre);
}
