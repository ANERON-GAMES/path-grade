import { PATH_CAUSES, PathCause, classifySample } from "./grade.js";

export function createCounters() {
  return {
    lastCause: null,
    flaps: 0,
    counts: zeroCounts()
  };
}

export function updateCounters(counters, sample) {
  const prior = normalizeCounters(counters);
  const grade = classifySample(sample);
  const counts = zeroCounts();
  for (const cause of PATH_CAUSES) {
    counts[cause] = prior.counts[cause];
  }
  counts[grade.cause] += 1;

  const changed = prior.lastCause != null && prior.lastCause !== grade.cause;
  return {
    lastCause: grade.cause,
    flaps: changed ? prior.flaps + 1 : prior.flaps,
    counts
  };
}

function normalizeCounters(counters) {
  if (counters == null) {
    return createCounters();
  }
  if (typeof counters !== "object" || Array.isArray(counters)) {
    throw new TypeError("counters must be an object or null");
  }
  return {
    lastCause: readLastCause(counters.lastCause),
    flaps: readFlaps(counters.flaps),
    counts: readCounts(counters.counts)
  };
}

function readLastCause(lastCause) {
  if (lastCause == null) {
    return null;
  }
  if (!PATH_CAUSES.includes(lastCause)) {
    throw new TypeError("counters.lastCause must be a path cause or null");
  }
  return lastCause;
}

function readFlaps(flaps) {
  if (flaps == null) {
    return 0;
  }
  if (typeof flaps !== "number" || !Number.isInteger(flaps) || flaps < 0) {
    throw new TypeError("counters.flaps must be a non-negative integer");
  }
  return flaps;
}

function readCounts(counts) {
  if (counts == null) {
    return zeroCounts();
  }
  if (typeof counts !== "object" || Array.isArray(counts)) {
    throw new TypeError("counters.counts must be an object");
  }
  const read = zeroCounts();
  for (const cause of PATH_CAUSES) {
    read[cause] = readCount(counts, cause);
  }
  return read;
}

function readCount(counts, cause) {
  if (!Object.hasOwn(counts, cause) || counts[cause] == null) {
    return 0;
  }
  const value = counts[cause];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError("counter totals must be non-negative integers");
  }
  return value;
}

function zeroCounts() {
  return {
    [PathCause.Clear]: 0,
    [PathCause.Isp]: 0,
    [PathCause.Origin]: 0,
    [PathCause.Edge]: 0,
    [PathCause.Local]: 0
  };
}
