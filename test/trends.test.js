import assert from "node:assert/strict";
import test from "node:test";
import {
  DOMINANT_FAULT_RATE,
  P50,
  P95,
  TREND_MIN_SAMPLES,
  TrendInterpretation,
  average,
  buildTrends,
  interpretTrends,
  percentile
} from "../src/index.js";

const down = { ok: false, elapsedMs: null };

function up(elapsedMs) {
  return { ok: true, elapsedMs };
}

function sample(overrides) {
  return {
    dns: up(10),
    icmp: up(10),
    localApi: up(20),
    publicApi: up(30),
    ...overrides
  };
}

function repeat(count, overrides) {
  return Array.from({ length: count }, () => sample(overrides));
}

function rates(overrides) {
  return {
    clear: 0,
    isp: 0,
    origin: 0,
    edge: 0,
    local: 0,
    ...overrides
  };
}

test("percentile uses nearest rank and does not mutate the input", () => {
  const values = [30, 10, 20, 40];
  assert.equal(percentile(values, P50), 20);
  assert.equal(percentile(values, P95), 40);
  assert.equal(percentile(values, 0), 10);
  assert.equal(percentile(values, 100), 40);
  assert.deepEqual(values, [30, 10, 20, 40]);
});

test("percentile of one value is that value at every rank", () => {
  assert.equal(percentile([15], 0), 15);
  assert.equal(percentile([15], 50), 15);
  assert.equal(percentile([15], 95), 15);
  assert.equal(percentile([15], 100), 15);
});

test("percentile drops non-finite entries and keeps zero and negatives", () => {
  assert.equal(percentile([Number.NaN, "20", null, undefined, Number.POSITIVE_INFINITY], 50), null);
  assert.equal(percentile([10, Number.NaN, 30], 50), 10);
  assert.equal(percentile([-5, 10], 0), -5);
  assert.equal(percentile([-5, 10], 100), 10);
  assert.equal(percentile([0, 0, 0], 95), 0);
});

test("a hundred sorted samples put p95 on the 95th value", () => {
  const values = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentile(values, 95), 95);
  assert.equal(percentile(values, 50), 50);
});

test("percentile rejects a bad list or a rank outside 0 to 100", () => {
  assert.throws(() => percentile(null, 50), TypeError);
  assert.throws(() => percentile({}, 50), TypeError);
  assert.throws(() => percentile([10], -0.1), RangeError);
  assert.throws(() => percentile([10], 100.1), RangeError);
  assert.throws(() => percentile([10], Number.NaN), RangeError);
  assert.throws(() => percentile([10], "50"), RangeError);
});

test("average is the mean of the finite numbers and does not mutate the input", () => {
  const values = [10, Number.NaN, 30];
  assert.equal(average(values), 20);
  assert.deepEqual(values, [10, Number.NaN, 30]);
  assert.equal(average([]), null);
  assert.equal(average([Number.NaN, "4"]), null);
  assert.equal(average([0, 0]), 0);
});

test("average rejects a value that is not an array", () => {
  assert.throws(() => average(null), TypeError);
  assert.throws(() => average("10,20"), TypeError);
});

test("an empty window has zero rates, no flaps, and null latency", () => {
  assert.deepEqual(buildTrends([]), {
    count: 0,
    rates: rates({}),
    flaps: 0,
    latency: {
      dns: { count: 0, averageMs: null, p50Ms: null, p95Ms: null },
      icmp: { count: 0, averageMs: null, p50Ms: null, p95Ms: null },
      localApi: { count: 0, averageMs: null, p50Ms: null, p95Ms: null },
      publicApi: { count: 0, averageMs: null, p50Ms: null, p95Ms: null }
    }
  });
});

test("rates cover the window and latency ignores probes that are down", () => {
  const samples = [
    sample({ dns: up(10) }),
    sample({ dns: up(20) }),
    sample({ dns: up(30) }),
    sample({ dns: up(40) }),
    sample({ dns: down }),
    sample({ dns: up(100) })
  ];
  const trends = buildTrends(samples);
  assert.equal(trends.count, 6);
  assert.equal(trends.rates.clear, 1);
  assert.equal(trends.rates.isp, 0);
  assert.equal(trends.latency.dns.count, 5);
  assert.equal(trends.latency.dns.averageMs, 40);
  assert.equal(trends.latency.dns.p50Ms, 30);
  assert.equal(trends.latency.dns.p95Ms, 100);
  assert.equal(trends.latency.publicApi.count, 6);
  assert.equal(trends.latency.publicApi.averageMs, 30);
});

test("a mixed window reports each cause rate and the flap count", () => {
  const samples = [
    sample(),
    sample({ localApi: up(800) }),
    sample({ localApi: up(800) }),
    sample({ publicApi: down }),
    sample({ localApi: down }),
    sample({ dns: down, icmp: down })
  ];
  const trends = buildTrends(samples);
  assert.equal(trends.rates.clear, 1 / 6);
  assert.equal(trends.rates.origin, 2 / 6);
  assert.equal(trends.rates.edge, 1 / 6);
  assert.equal(trends.rates.local, 1 / 6);
  assert.equal(trends.rates.isp, 1 / 6);
  assert.equal(trends.flaps, 4);
  assert.equal(
    trends.rates.clear * trends.count +
      trends.rates.isp * trends.count +
      trends.rates.origin * trends.count +
      trends.rates.edge * trends.count +
      trends.rates.local * trends.count,
    trends.count
  );
});

test("down probes are left out of the percentile even when the grade is an outage", () => {
  const trends = buildTrends([
    sample({ dns: down, icmp: down, localApi: up(25), publicApi: up(35) }),
    sample({ dns: up(15), icmp: down, localApi: down, publicApi: down })
  ]);
  assert.equal(trends.rates.isp, 0.5);
  assert.equal(trends.rates.origin, 0.5);
  assert.equal(trends.latency.dns.count, 1);
  assert.equal(trends.latency.dns.averageMs, 15);
  assert.equal(trends.latency.icmp.count, 0);
  assert.equal(trends.latency.icmp.p95Ms, null);
  assert.equal(trends.latency.localApi.count, 1);
  assert.equal(trends.latency.publicApi.p50Ms, 35);
});

test("buildTrends does not mutate the samples", () => {
  const probe = up(40);
  const samples = [{ dns: probe, icmp: probe, localApi: probe, publicApi: probe }];
  buildTrends(samples);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].dns, probe);
  assert.deepEqual(probe, { ok: true, elapsedMs: 40 });
});

test("buildTrends rejects a sample list that is not an array and a sample that is not an object", () => {
  assert.throws(() => buildTrends(null), TypeError);
  assert.throws(() => buildTrends({}), TypeError);
  assert.throws(() => buildTrends([null]), TypeError);
});

test("five slow-origin samples match the usage window", () => {
  const slowOrigin = {
    dns: { ok: true, elapsedMs: 12 },
    icmp: { ok: true, elapsedMs: 18 },
    localApi: { ok: true, elapsedMs: 800 },
    publicApi: { ok: true, elapsedMs: 40 }
  };
  const trends = buildTrends([slowOrigin, slowOrigin, slowOrigin, slowOrigin, slowOrigin]);
  assert.equal(trends.rates.origin, 1);
  assert.equal(trends.flaps, 0);
  assert.equal(trends.latency.localApi.averageMs, 800);
  assert.equal(trends.latency.publicApi.p95Ms, 40);
  assert.equal(interpretTrends(trends), TrendInterpretation.Origin);
});

test("a window shorter than the minimum is not interpreted", () => {
  const trends = buildTrends(repeat(TREND_MIN_SAMPLES - 1, { dns: down, icmp: down }));
  assert.equal(trends.rates.isp, 1);
  assert.equal(interpretTrends(trends), TrendInterpretation.ShortWindow);
  assert.equal(interpretTrends({ count: 0, rates: rates({}) }), TrendInterpretation.ShortWindow);
});

test("a dominant isp rate names the isp path", () => {
  const trends = buildTrends(repeat(TREND_MIN_SAMPLES, { dns: down, icmp: down }));
  assert.equal(interpretTrends(trends), TrendInterpretation.Isp);
});

test("a dominant origin rate names the origin", () => {
  const slow = buildTrends(repeat(TREND_MIN_SAMPLES, { localApi: up(800) }));
  const dead = buildTrends(repeat(TREND_MIN_SAMPLES, { localApi: down, publicApi: down }));
  assert.equal(interpretTrends(slow), TrendInterpretation.Origin);
  assert.equal(interpretTrends(dead), TrendInterpretation.Origin);
});

test("a dominant edge rate says the origin is responding", () => {
  const trends = buildTrends(repeat(TREND_MIN_SAMPLES, { publicApi: down }));
  assert.equal(interpretTrends(trends), TrendInterpretation.Edge);
});

test("a dominant local rate says the public api is responding", () => {
  const trends = buildTrends(repeat(TREND_MIN_SAMPLES, { localApi: down }));
  assert.equal(interpretTrends(trends), TrendInterpretation.Local);
});

test("an even split names the earlier cause in isp, origin, edge, local order", () => {
  assert.equal(DOMINANT_FAULT_RATE, 0.5);
  assert.equal(
    interpretTrends({
      count: 10,
      rates: rates({ isp: 0.5, origin: 0.5 })
    }),
    TrendInterpretation.Isp
  );
  assert.equal(
    interpretTrends({
      count: 10,
      rates: rates({ origin: 0.5, edge: 0.5 })
    }),
    TrendInterpretation.Origin
  );
  assert.equal(
    interpretTrends({
      count: 10,
      rates: rates({ edge: 0.5, local: 0.5 })
    }),
    TrendInterpretation.Edge
  );
});

test("a fault rate under half is intermittent", () => {
  const samples = repeat(4).concat([sample({ publicApi: down })]);
  const trends = buildTrends(samples);
  assert.equal(trends.count, TREND_MIN_SAMPLES);
  assert.equal(trends.rates.edge, 0.2);
  assert.equal(interpretTrends(trends), TrendInterpretation.Intermittent);
});

test("a window of clear samples is healthy", () => {
  const trends = buildTrends(repeat(TREND_MIN_SAMPLES));
  assert.equal(interpretTrends(trends), TrendInterpretation.Healthy);
});

test("interpretation reads rates and ignores a contradictory latency block", () => {
  assert.equal(
    interpretTrends({
      count: TREND_MIN_SAMPLES,
      rates: rates({ clear: 1 }),
      latency: { publicApi: { p95Ms: 2900 } }
    }),
    TrendInterpretation.Healthy
  );
});

test("interpretTrends rejects a malformed trends object", () => {
  assert.throws(() => interpretTrends(null), TypeError);
  assert.throws(() => interpretTrends([]), TypeError);
  assert.throws(() => interpretTrends({ count: 1.5, rates: rates({}) }), TypeError);
  assert.throws(() => interpretTrends({ count: -1, rates: rates({}) }), TypeError);
  assert.throws(() => interpretTrends({ count: TREND_MIN_SAMPLES, rates: null }), TypeError);
  assert.throws(
    () => interpretTrends({ count: TREND_MIN_SAMPLES, rates: rates({ isp: 1.1 }) }),
    TypeError
  );
  assert.throws(
    () => interpretTrends({ count: TREND_MIN_SAMPLES, rates: { clear: 1 } }),
    TypeError
  );
});

test("interpretation strings stay stable", () => {
  assert.equal(TrendInterpretation.ShortWindow, "Not enough samples to interpret the path.");
  assert.equal(TrendInterpretation.Isp, "The ISP path is down.");
  assert.equal(TrendInterpretation.Origin, "The origin is down or slow.");
  assert.equal(TrendInterpretation.Edge, "The edge is down or slow. The origin is responding.");
  assert.equal(TrendInterpretation.Local, "The local API is down. The public API is responding.");
  assert.equal(
    TrendInterpretation.Intermittent,
    "The path is mostly healthy, with intermittent faults."
  );
  assert.equal(TrendInterpretation.Healthy, "The path is healthy.");
  assert.equal(Object.isFrozen(TrendInterpretation), true);
});
