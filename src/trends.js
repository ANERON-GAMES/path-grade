import { PATH_CAUSES, PathCause, classifySample, isProbeUp } from "./grade.js";

export const P50 = 50;
export const P95 = 95;
export const TREND_MIN_SAMPLES = 5;
export const DOMINANT_FAULT_RATE = 0.5;

export const TrendInterpretation = Object.freeze({
  ShortWindow: "Not enough samples to interpret the path.",
  Isp: "The ISP path is down.",
  Origin: "The origin is down or slow.",
  Edge: "The edge is down or slow. The origin is responding.",
  Local: "The local API is down. The public API is responding.",
  Intermittent: "The path is mostly healthy, with intermittent faults.",
  Healthy: "The path is healthy."
});

const FAULT_CAUSES = Object.freeze([
  PathCause.Isp,
  PathCause.Origin,
  PathCause.Edge,
  PathCause.Local
]);

export function percentile(values, p) {
  if (!Array.isArray(values)) {
    throw new TypeError("values must be an array");
  }
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 100) {
    throw new RangeError("percentile must be between 0 and 100");
  }

  const finite = finiteNumbers(values);
  if (finite.length === 0) {
    return null;
  }

  finite.sort((left, right) => left - right);
  const rank = Math.ceil((p * finite.length) / 100);
  const index = Math.min(finite.length, Math.max(rank, 1)) - 1;
  return finite[index];
}

export function average(values) {
  if (!Array.isArray(values)) {
    throw new TypeError("values must be an array");
  }

  const finite = finiteNumbers(values);
  if (finite.length === 0) {
    return null;
  }

  let sum = 0;
  for (const value of finite) {
    sum += value;
  }
  return sum / finite.length;
}

export function buildTrends(samples) {
  if (!Array.isArray(samples)) {
    throw new TypeError("samples must be an array");
  }

  const grades = samples.map((sample) => classifySample(sample));
  return {
    count: grades.length,
    rates: ratesFrom(grades),
    flaps: flapsFrom(grades),
    latency: {
      dns: summarizeProbe(samples, "dns"),
      icmp: summarizeProbe(samples, "icmp"),
      localApi: summarizeProbe(samples, "localApi"),
      publicApi: summarizeProbe(samples, "publicApi")
    }
  };
}

export function interpretTrends(trends) {
  if (trends == null || typeof trends !== "object" || Array.isArray(trends)) {
    throw new TypeError("trends must be an object");
  }
  if (typeof trends.count !== "number" || !Number.isInteger(trends.count) || trends.count < 0) {
    throw new TypeError("trends.count must be a non-negative integer");
  }
  if (trends.count < TREND_MIN_SAMPLES) {
    return TrendInterpretation.ShortWindow;
  }

  const rates = readRates(trends.rates);
  if (rates[PathCause.Isp] >= DOMINANT_FAULT_RATE) {
    return TrendInterpretation.Isp;
  }
  if (rates[PathCause.Origin] >= DOMINANT_FAULT_RATE) {
    return TrendInterpretation.Origin;
  }
  if (rates[PathCause.Edge] >= DOMINANT_FAULT_RATE) {
    return TrendInterpretation.Edge;
  }
  if (rates[PathCause.Local] >= DOMINANT_FAULT_RATE) {
    return TrendInterpretation.Local;
  }
  for (const cause of FAULT_CAUSES) {
    if (rates[cause] > 0) {
      return TrendInterpretation.Intermittent;
    }
  }
  return TrendInterpretation.Healthy;
}

function finiteNumbers(values) {
  const finite = [];
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      finite.push(value);
    }
  }
  return finite;
}

function ratesFrom(grades) {
  const rates = zeroRates();
  if (grades.length === 0) {
    return rates;
  }
  const counts = zeroRates();
  for (const grade of grades) {
    counts[grade.cause] += 1;
  }
  for (const cause of PATH_CAUSES) {
    rates[cause] = counts[cause] / grades.length;
  }
  return rates;
}

function flapsFrom(grades) {
  let flaps = 0;
  let lastCause = null;
  for (const grade of grades) {
    if (lastCause != null && lastCause !== grade.cause) {
      flaps += 1;
    }
    lastCause = grade.cause;
  }
  return flaps;
}

function summarizeProbe(samples, key) {
  const values = [];
  for (const sample of samples) {
    const probe = sample[key];
    if (isProbeUp(probe)) {
      values.push(probe.elapsedMs);
    }
  }
  return {
    count: values.length,
    averageMs: average(values),
    p50Ms: percentile(values, P50),
    p95Ms: percentile(values, P95)
  };
}

function zeroRates() {
  return {
    [PathCause.Clear]: 0,
    [PathCause.Isp]: 0,
    [PathCause.Origin]: 0,
    [PathCause.Edge]: 0,
    [PathCause.Local]: 0
  };
}

function readRates(rates) {
  if (rates == null || typeof rates !== "object" || Array.isArray(rates)) {
    throw new TypeError("trends.rates must be an object");
  }
  const read = zeroRates();
  for (const cause of PATH_CAUSES) {
    const rate = rates[cause];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new TypeError("each cause rate must be a finite number from 0 to 1");
    }
    read[cause] = rate;
  }
  return read;
}
