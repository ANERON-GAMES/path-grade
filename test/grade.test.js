import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEAD_LATENCY_MS,
  EXCELLENT_LATENCY_MS,
  FAIR_LATENCY_MS,
  GOOD_LATENCY_MS,
  LatencyBand,
  PATH_CAUSES,
  POOR_LATENCY_MS,
  PathCause,
  classifySample,
  isProbeUp,
  latencyBand
} from "../src/index.js";

const down = { ok: false, elapsedMs: null };

function up(elapsedMs) {
  return { ok: true, elapsedMs };
}

function sample(overrides) {
  return {
    dns: up(20),
    icmp: up(18),
    localApi: up(30),
    publicApi: up(40),
    ...overrides
  };
}

test("latency bands follow the named cutoffs", () => {
  assert.equal(latencyBand(0), LatencyBand.Excellent);
  assert.equal(latencyBand(EXCELLENT_LATENCY_MS - 0.1), LatencyBand.Excellent);
  assert.equal(latencyBand(EXCELLENT_LATENCY_MS), LatencyBand.Good);
  assert.equal(latencyBand(GOOD_LATENCY_MS - 1), LatencyBand.Good);
  assert.equal(latencyBand(GOOD_LATENCY_MS), LatencyBand.Fair);
  assert.equal(latencyBand(FAIR_LATENCY_MS - 1), LatencyBand.Fair);
  assert.equal(latencyBand(FAIR_LATENCY_MS), LatencyBand.Poor);
  assert.equal(latencyBand(POOR_LATENCY_MS - 1), LatencyBand.Poor);
  assert.equal(latencyBand(POOR_LATENCY_MS), LatencyBand.Bad);
  assert.equal(latencyBand(DEAD_LATENCY_MS - 1), LatencyBand.Bad);
  assert.equal(latencyBand(DEAD_LATENCY_MS), LatencyBand.Dead);
  assert.equal(latencyBand(DEAD_LATENCY_MS + 1), LatencyBand.Dead);
});

test("a latency that is not a usable duration has no band", () => {
  assert.equal(latencyBand(-1), null);
  assert.equal(latencyBand(Number.NaN), null);
  assert.equal(latencyBand(Number.POSITIVE_INFINITY), null);
  assert.equal(latencyBand(Number.NEGATIVE_INFINITY), null);
  assert.equal(latencyBand("80"), null);
  assert.equal(latencyBand(null), null);
  assert.equal(latencyBand(undefined), null);
});

test("a probe is up only when it succeeded inside the dead cutoff", () => {
  assert.equal(isProbeUp(up(0)), true);
  assert.equal(isProbeUp(up(DEAD_LATENCY_MS - 1)), true);
  assert.equal(isProbeUp(up(DEAD_LATENCY_MS)), false);
  assert.equal(isProbeUp({ ok: false, elapsedMs: 10 }), false);
  assert.equal(isProbeUp({ ok: true, elapsedMs: null }), false);
  assert.equal(isProbeUp({ ok: true, elapsedMs: -5 }), false);
  assert.equal(isProbeUp({ ok: true, elapsedMs: Number.NaN }), false);
  assert.equal(isProbeUp({ ok: true }), false);
  assert.equal(isProbeUp({ ok: 1, elapsedMs: 10 }), false);
  assert.equal(isProbeUp({ ok: "true", elapsedMs: 10 }), false);
  assert.equal(isProbeUp(null), false);
  assert.equal(isProbeUp(undefined), false);
  assert.equal(isProbeUp([]), false);
  assert.equal(isProbeUp("up"), false);
});

test("dns and icmp both dead is the isp, even when both apis are also dead", () => {
  assert.deepEqual(
    classifySample({
      dns: down,
      icmp: down,
      localApi: down,
      publicApi: down
    }),
    { cause: PathCause.Isp, band: LatencyBand.Dead, latencyMs: null }
  );
});

test("dns and icmp both dead is the isp when the apis are healthy", () => {
  assert.deepEqual(classifySample(sample({ dns: down, icmp: down })), {
    cause: PathCause.Isp,
    band: LatencyBand.Dead,
    latencyMs: null
  });
});

test("a timeout at the dead cutoff on both isp probes is an isp outage", () => {
  assert.equal(
    classifySample(
      sample({
        dns: up(DEAD_LATENCY_MS),
        icmp: up(DEAD_LATENCY_MS)
      })
    ).cause,
    PathCause.Isp
  );
});

test("one dead isp probe does not hide a dead origin", () => {
  assert.equal(
    classifySample(sample({ dns: down, localApi: down, publicApi: down })).cause,
    PathCause.Origin
  );
  assert.equal(
    classifySample(sample({ icmp: down, localApi: down, publicApi: down })).cause,
    PathCause.Origin
  );
});

test("both apis dead is the origin when the isp probes passed", () => {
  assert.deepEqual(classifySample(sample({ localApi: down, publicApi: down })), {
    cause: PathCause.Origin,
    band: LatencyBand.Dead,
    latencyMs: null
  });
});

test("a dead public api with a live local api is the edge, not the origin", () => {
  assert.deepEqual(classifySample(sample({ publicApi: down })), {
    cause: PathCause.Edge,
    band: LatencyBand.Dead,
    latencyMs: null
  });
});

test("a dead public api outranks a slow local api", () => {
  assert.equal(
    classifySample(sample({ localApi: up(800), publicApi: down })).cause,
    PathCause.Edge
  );
});

test("one dead isp probe does not turn a dead public api into an isp outage", () => {
  assert.equal(classifySample(sample({ icmp: down, publicApi: down })).cause, PathCause.Edge);
  assert.equal(classifySample(sample({ dns: down, publicApi: down })).cause, PathCause.Edge);
});

test("a dead local api with a live public api is local, not the origin and not the edge", () => {
  assert.deepEqual(classifySample(sample({ localApi: down })), {
    cause: PathCause.Local,
    band: LatencyBand.Dead,
    latencyMs: null
  });
});

test("the usage sample grades a slow origin, a dead edge, and an isp outage", () => {
  const slowOrigin = {
    dns: { ok: true, elapsedMs: 12 },
    icmp: { ok: true, elapsedMs: 18 },
    localApi: { ok: true, elapsedMs: 800 },
    publicApi: { ok: true, elapsedMs: 40 }
  };
  const deadEdge = {
    dns: { ok: true, elapsedMs: 12 },
    icmp: { ok: true, elapsedMs: 18 },
    localApi: { ok: true, elapsedMs: 40 },
    publicApi: { ok: false, elapsedMs: null }
  };
  const ispDown = {
    dns: { ok: false, elapsedMs: null },
    icmp: { ok: false, elapsedMs: null },
    localApi: { ok: false, elapsedMs: null },
    publicApi: { ok: false, elapsedMs: null }
  };

  assert.deepEqual(classifySample(slowOrigin), {
    cause: PathCause.Origin,
    band: LatencyBand.Poor,
    latencyMs: 800
  });
  assert.deepEqual(classifySample(deadEdge), {
    cause: PathCause.Edge,
    band: LatencyBand.Dead,
    latencyMs: null
  });
  assert.deepEqual(classifySample(ispDown), {
    cause: PathCause.Isp,
    band: LatencyBand.Dead,
    latencyMs: null
  });
});

test("a slow local api is the origin when the isp probes are up", () => {
  assert.deepEqual(classifySample(sample({ localApi: up(800), publicApi: up(40) })), {
    cause: PathCause.Origin,
    band: LatencyBand.Poor,
    latencyMs: 800
  });
});

test("a slow local api stays the origin when the isp probes are slow too", () => {
  assert.deepEqual(
    classifySample(
      sample({
        dns: up(2000),
        icmp: up(2000),
        localApi: up(2000),
        publicApi: up(2500)
      })
    ),
    { cause: PathCause.Origin, band: LatencyBand.Bad, latencyMs: 2000 }
  );
});

test("a fast local api and a slow public api is the edge", () => {
  assert.deepEqual(classifySample(sample({ localApi: up(40), publicApi: up(800) })), {
    cause: PathCause.Edge,
    band: LatencyBand.Poor,
    latencyMs: 800
  });
});

test("a slow icmp probe does not make a fast service an isp fault", () => {
  assert.deepEqual(classifySample(sample({ icmp: up(2000), publicApi: up(50) })), {
    cause: PathCause.Clear,
    band: LatencyBand.Excellent,
    latencyMs: 50
  });
});

test("a slow icmp probe does not steal a slow public api from the edge", () => {
  assert.equal(
    classifySample(sample({ dns: up(2000), icmp: up(2000), publicApi: up(2000) })).cause,
    PathCause.Edge
  );
});

test("both apis under the slow cutoff are clear, graded by the public latency", () => {
  assert.deepEqual(classifySample(sample({ localApi: up(400), publicApi: up(40) })), {
    cause: PathCause.Clear,
    band: LatencyBand.Excellent,
    latencyMs: 40
  });
  assert.deepEqual(classifySample(sample({ localApi: up(40), publicApi: up(400) })), {
    cause: PathCause.Clear,
    band: LatencyBand.Fair,
    latencyMs: 400
  });
});

test("the slow cutoff starts at the fair latency", () => {
  assert.equal(
    classifySample(sample({ localApi: up(FAIR_LATENCY_MS - 1), publicApi: up(40) })).cause,
    PathCause.Clear
  );
  assert.deepEqual(classifySample(sample({ localApi: up(FAIR_LATENCY_MS), publicApi: up(40) })), {
    cause: PathCause.Origin,
    band: LatencyBand.Poor,
    latencyMs: FAIR_LATENCY_MS
  });
  assert.equal(
    classifySample(sample({ publicApi: up(FAIR_LATENCY_MS - 1) })).band,
    LatencyBand.Fair
  );
  assert.deepEqual(classifySample(sample({ publicApi: up(FAIR_LATENCY_MS) })), {
    cause: PathCause.Edge,
    band: LatencyBand.Poor,
    latencyMs: FAIR_LATENCY_MS
  });
});

test("a public latency of 1000 ms is a bad edge", () => {
  assert.deepEqual(classifySample(sample({ publicApi: up(POOR_LATENCY_MS) })), {
    cause: PathCause.Edge,
    band: LatencyBand.Bad,
    latencyMs: POOR_LATENCY_MS
  });
});

test("an empty sample is an isp outage because every probe is missing", () => {
  assert.equal(classifySample({}).cause, PathCause.Isp);
});

test("a missing probe is down", () => {
  const partial = sample();
  delete partial.dns;
  delete partial.icmp;
  assert.equal(classifySample(partial).cause, PathCause.Isp);
});

test("classifySample rejects a sample that is not an object", () => {
  assert.throws(() => classifySample(null), TypeError);
  assert.throws(() => classifySample(undefined), TypeError);
  assert.throws(() => classifySample([]), TypeError);
  assert.throws(() => classifySample("sample"), TypeError);
  assert.throws(() => classifySample(40), TypeError);
});

test("the grade keeps only cause, band, and latency", () => {
  const grade = classifySample({
    ...sample(),
    host: "ignored.example",
    url: "https://ignored.example/health"
  });
  assert.deepEqual(Object.keys(grade).sort(), ["band", "cause", "latencyMs"]);
});

test("cause and band names stay the stable strings", () => {
  assert.deepEqual(PATH_CAUSES, ["clear", "isp", "origin", "edge", "local"]);
  assert.equal(PathCause.Clear, "clear");
  assert.equal(PathCause.Isp, "isp");
  assert.equal(PathCause.Origin, "origin");
  assert.equal(PathCause.Edge, "edge");
  assert.equal(PathCause.Local, "local");
  assert.equal(LatencyBand.Excellent, "excellent");
  assert.equal(LatencyBand.Good, "good");
  assert.equal(LatencyBand.Fair, "fair");
  assert.equal(LatencyBand.Poor, "poor");
  assert.equal(LatencyBand.Bad, "bad");
  assert.equal(LatencyBand.Dead, "dead");
  assert.equal(Object.isFrozen(PathCause), true);
  assert.equal(Object.isFrozen(LatencyBand), true);
  assert.equal(Object.isFrozen(PATH_CAUSES), true);
});

test("source files import only sibling modules", () => {
  for (const name of ["grade.js", "trends.js", "counters.js", "index.js"]) {
    const source = readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
    const lines = source.split("\n").filter((line) => line.startsWith("import "));
    for (const line of lines) {
      assert.match(line, /from "\.\/[a-z]+\.js";$/);
    }
    assert.equal(source.includes("node:"), false);
  }
});
