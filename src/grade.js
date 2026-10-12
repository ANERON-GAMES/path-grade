export const EXCELLENT_LATENCY_MS = 80;
export const GOOD_LATENCY_MS = 150;
export const FAIR_LATENCY_MS = 500;
export const POOR_LATENCY_MS = 1000;
export const DEAD_LATENCY_MS = 3000;

export const PathCause = Object.freeze({
  Clear: "clear",
  Isp: "isp",
  Origin: "origin",
  Edge: "edge",
  Local: "local"
});

export const PATH_CAUSES = Object.freeze([
  PathCause.Clear,
  PathCause.Isp,
  PathCause.Origin,
  PathCause.Edge,
  PathCause.Local
]);

export const LatencyBand = Object.freeze({
  Excellent: "excellent",
  Good: "good",
  Fair: "fair",
  Poor: "poor",
  Bad: "bad",
  Dead: "dead"
});

export function latencyBand(elapsedMs) {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return null;
  }
  if (elapsedMs < EXCELLENT_LATENCY_MS) {
    return LatencyBand.Excellent;
  }
  if (elapsedMs < GOOD_LATENCY_MS) {
    return LatencyBand.Good;
  }
  if (elapsedMs < FAIR_LATENCY_MS) {
    return LatencyBand.Fair;
  }
  if (elapsedMs < POOR_LATENCY_MS) {
    return LatencyBand.Poor;
  }
  if (elapsedMs < DEAD_LATENCY_MS) {
    return LatencyBand.Bad;
  }
  return LatencyBand.Dead;
}

export function isProbeUp(probe) {
  if (probe == null || typeof probe !== "object" || Array.isArray(probe)) {
    return false;
  }
  if (probe.ok !== true) {
    return false;
  }
  const band = latencyBand(probe.elapsedMs);
  return band != null && band !== LatencyBand.Dead;
}

export function classifySample(sample) {
  if (sample == null || typeof sample !== "object" || Array.isArray(sample)) {
    throw new TypeError("sample must be an object");
  }

  const dnsUp = isProbeUp(sample.dns);
  const icmpUp = isProbeUp(sample.icmp);
  const localUp = isProbeUp(sample.localApi);
  const publicUp = isProbeUp(sample.publicApi);

  if (!dnsUp && !icmpUp) {
    return result(PathCause.Isp, LatencyBand.Dead, null);
  }

  if (!localUp && !publicUp) {
    return result(PathCause.Origin, LatencyBand.Dead, null);
  }

  if (localUp && !publicUp) {
    return result(PathCause.Edge, LatencyBand.Dead, null);
  }

  if (!localUp && publicUp) {
    return result(PathCause.Local, LatencyBand.Dead, null);
  }

  if (isSlowLatency(sample.localApi.elapsedMs)) {
    return result(
      PathCause.Origin,
      latencyBand(sample.localApi.elapsedMs),
      sample.localApi.elapsedMs
    );
  }

  if (isSlowLatency(sample.publicApi.elapsedMs)) {
    return result(
      PathCause.Edge,
      latencyBand(sample.publicApi.elapsedMs),
      sample.publicApi.elapsedMs
    );
  }

  return result(
    PathCause.Clear,
    latencyBand(sample.publicApi.elapsedMs),
    sample.publicApi.elapsedMs
  );
}

function isSlowLatency(elapsedMs) {
  return elapsedMs >= FAIR_LATENCY_MS;
}

function result(cause, band, latencyMs) {
  return {
    cause,
    band,
    latencyMs
  };
}
