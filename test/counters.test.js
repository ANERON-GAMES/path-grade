import assert from "node:assert/strict";
import test from "node:test";
import { PathCause, buildTrends, createCounters, updateCounters } from "../src/index.js";

const down = { ok: false, elapsedMs: null };

function up(elapsedMs) {
  return { ok: true, elapsedMs };
}

function sample(overrides) {
  return {
    dns: up(12),
    icmp: up(18),
    localApi: up(30),
    publicApi: up(40),
    ...overrides
  };
}

test("createCounters starts at zero and each call is a new object", () => {
  const first = createCounters();
  const second = createCounters();
  assert.deepEqual(first, {
    lastCause: null,
    flaps: 0,
    counts: { clear: 0, isp: 0, origin: 0, edge: 0, local: 0 }
  });
  first.counts.clear = 4;
  assert.equal(second.counts.clear, 0);
});

test("the same cause does not flap, and a cause change does", () => {
  const healthy = sample();
  const slowOrigin = sample({ localApi: up(800) });
  const edge = sample({ publicApi: down });

  let counters = updateCounters(null, healthy);
  counters = updateCounters(counters, healthy);
  counters = updateCounters(counters, edge);
  counters = updateCounters(counters, edge);
  counters = updateCounters(counters, slowOrigin);

  assert.equal(counters.lastCause, PathCause.Origin);
  assert.equal(counters.flaps, 2);
  assert.deepEqual(counters.counts, {
    clear: 2,
    isp: 0,
    origin: 1,
    edge: 2,
    local: 0
  });
});

test("a band change inside one cause is not a flap", () => {
  const poor = sample({ localApi: up(800) });
  const bad = sample({ localApi: up(2000) });
  const counters = updateCounters(updateCounters(null, poor), bad);
  assert.equal(counters.flaps, 0);
  assert.equal(counters.counts.origin, 2);
  assert.equal(counters.lastCause, PathCause.Origin);
});

test("updateCounters does not mutate the previous counters", () => {
  const prior = createCounters();
  const next = updateCounters(prior, sample());
  assert.equal(prior.lastCause, null);
  assert.equal(prior.flaps, 0);
  assert.equal(prior.counts.clear, 0);
  assert.equal(next.counts.clear, 1);
  assert.notEqual(next.counts, prior.counts);
});

test("streaming counters match the window flap count and the cause totals", () => {
  const samples = [
    sample(),
    sample({ localApi: up(800) }),
    sample({ publicApi: down }),
    sample({ localApi: down }),
    sample({ dns: down, icmp: down }),
    sample()
  ];
  let counters = null;
  for (const reading of samples) {
    counters = updateCounters(counters, reading);
  }
  const trends = buildTrends(samples);
  assert.equal(counters.flaps, trends.flaps);
  assert.equal(counters.counts.clear / samples.length, trends.rates.clear);
  assert.equal(counters.counts.isp / samples.length, trends.rates.isp);
  assert.equal(counters.counts.origin / samples.length, trends.rates.origin);
  assert.equal(counters.counts.edge / samples.length, trends.rates.edge);
  assert.equal(counters.counts.local / samples.length, trends.rates.local);
});

test("a null counters argument starts from zero, and omitted fields do too", () => {
  const started = updateCounters(null, sample({ publicApi: down }));
  assert.equal(started.lastCause, PathCause.Edge);
  assert.equal(started.flaps, 0);
  assert.equal(started.counts.edge, 1);

  const filled = updateCounters({ lastCause: PathCause.Edge }, sample());
  assert.equal(filled.flaps, 1);
  assert.equal(filled.counts.clear, 1);
  assert.equal(filled.counts.edge, 0);
});

test("updateCounters rejects a bad counters object and a bad sample", () => {
  assert.throws(() => updateCounters("nope", null), {
    name: "TypeError",
    message: "counters must be an object or null"
  });
  assert.throws(() => updateCounters([], sample()), TypeError);
  assert.throws(() => updateCounters({ lastCause: "Clear" }, sample()), {
    name: "TypeError",
    message: "counters.lastCause must be a path cause or null"
  });
  assert.throws(() => updateCounters({ flaps: 1.5 }, sample()), {
    name: "TypeError",
    message: "counters.flaps must be a non-negative integer"
  });
  assert.throws(() => updateCounters({ flaps: -1 }, sample()), TypeError);
  assert.throws(() => updateCounters({ counts: [] }, sample()), TypeError);
  assert.throws(() => updateCounters({ counts: { clear: 1.2 } }, sample()), {
    name: "TypeError",
    message: "counter totals must be non-negative integers"
  });
  assert.throws(() => updateCounters(createCounters(), null), {
    name: "TypeError",
    message: "sample must be an object"
  });
});

test("unknown count keys are dropped on the next update", () => {
  const next = updateCounters(
    {
      lastCause: PathCause.Clear,
      flaps: 3,
      counts: { clear: 2, isp: 0, origin: 0, edge: 0, local: 0, other: 9 }
    },
    sample({ dns: down, icmp: down })
  );
  assert.equal(next.flaps, 4);
  assert.deepEqual(Object.keys(next.counts).sort(), ["clear", "edge", "isp", "local", "origin"]);
  assert.equal(next.counts.isp, 1);
  assert.equal(next.counts.clear, 2);
});
