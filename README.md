# path-grade

Grade a multi-path reachability sample so a slow origin is not blamed on the ISP, and a dead public edge is not blamed on the origin.

DNS and ICMP both down means the ISP path is down. The local API down and the public API down means the origin is down, even when the ISP probes still pass. The local API up and the public API down means the edge or the tunnel, not the machine. A local reading at or above 500 ms is a slow origin, including when the ISP probes are slow as well. A window of samples turns those grades into rates, percentiles, and one sentence. Callers pass booleans and millisecond readings. The probes stay outside the library.

## Install

The package is an ES module. It needs Node.js 20 or newer. It has no runtime dependencies. The package name is `@aneron/path-grade`. It is not published to the npm registry.

Clone this repository and run the tests:

```bash
git clone https://github.com/ANERON-GAMES/path-grade.git
cd path-grade
npm install
npm test
```

`npm test` runs `node --test`. `npm run lint` runs ESLint. `npm run format:check` runs Prettier.

Install it as a dependency from the git repository:

```bash
npm install github:ANERON-GAMES/path-grade
```

```js
import { buildTrends, classifySample, interpretTrends } from "@aneron/path-grade";
```

Code in this repository imports the same entry point with `./src/index.js`.

## Usage

A sample is one moment. Each probe is `{ ok, elapsedMs }`. `ok` is the probe's own success bit. `elapsedMs` is the duration in milliseconds, or `null` when there is no measurement.

```js
import { buildTrends, classifySample, interpretTrends, updateCounters } from "@aneron/path-grade";

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

const originGrade = classifySample(slowOrigin);
const edgeGrade = classifySample(deadEdge);
const ispGrade = classifySample(ispDown);

const trends = buildTrends([slowOrigin, slowOrigin, slowOrigin, slowOrigin, slowOrigin]);
const sentence = interpretTrends(trends);

let counters = null;
counters = updateCounters(counters, slowOrigin);
counters = updateCounters(counters, deadEdge);
```

`originGrade` is `{ cause: "origin", band: "poor", latencyMs: 800 }`. The ISP probes returned in 12 ms and 18 ms, so the slow local API is not an ISP fault. `edgeGrade` is `{ cause: "edge", band: "dead", latencyMs: null }`. The local API answered, so the dead public API is not an origin fault. `ispGrade` is `{ cause: "isp", band: "dead", latencyMs: null }`. Both ISP probes are down, so the dead APIs are not read as an origin outage.

`trends.rates.origin` is `1`. `trends.latency.localApi.averageMs` is `800`. `trends.latency.publicApi.p95Ms` is `40`. `sentence` is `"The origin is down or slow."` `counters.flaps` is `1`, because the cause changed from origin to edge.

## API reference

All functions are pure. They do not read the clock, the network, or the filesystem. They do not mutate their arguments.

### Constants

| Export                 | Value  | Meaning                                                                                                     |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `EXCELLENT_LATENCY_MS` | `80`   | A usable reading below this is excellent.                                                                   |
| `GOOD_LATENCY_MS`      | `150`  | A usable reading at or above 80 ms and below this is good.                                                  |
| `FAIR_LATENCY_MS`      | `500`  | A usable reading at or above 150 ms and below this is fair. At or above this, the reading is slow.          |
| `POOR_LATENCY_MS`      | `1000` | A usable reading at or above 500 ms and below this is poor. At or above this, and below 3000 ms, it is bad. |
| `DEAD_LATENCY_MS`      | `3000` | A reading at or above this is down, even when `ok` is `true`.                                               |
| `P50`                  | `50`   | The percentile `buildTrends` stores as `p50Ms`.                                                             |
| `P95`                  | `95`   | The percentile `buildTrends` stores as `p95Ms`.                                                             |
| `TREND_MIN_SAMPLES`    | `5`    | `interpretTrends` refuses a window shorter than this.                                                       |
| `DOMINANT_FAULT_RATE`  | `0.5`  | A cause at or above this rate is the sentence, when the window is long enough.                              |

### `PathCause`

Frozen. The fields and the strings are the same values.

| Field    | Value      | Meaning                                                                                              |
| -------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `Clear`  | `"clear"`  | Both APIs are up, and neither is slow.                                                               |
| `Isp`    | `"isp"`    | DNS and ICMP are both down.                                                                          |
| `Origin` | `"origin"` | Both APIs are down, or the local API is up and slow.                                                 |
| `Edge`   | `"edge"`   | The local API is up and the public API is down, or the local API is fast and the public API is slow. |
| `Local`  | `"local"`  | The local API is down and the public API is up.                                                      |

`PATH_CAUSES` is a frozen array of those strings, in the order `clear`, `isp`, `origin`, `edge`, `local`.

### `LatencyBand`

Frozen.

| Field       | Value         | Usable elapsed time                                                       |
| ----------- | ------------- | ------------------------------------------------------------------------- |
| `Excellent` | `"excellent"` | Below 80 ms.                                                              |
| `Good`      | `"good"`      | At or above 80 ms and below 150 ms.                                       |
| `Fair`      | `"fair"`      | At or above 150 ms and below 500 ms.                                      |
| `Poor`      | `"poor"`      | At or above 500 ms and below 1000 ms.                                     |
| `Bad`       | `"bad"`       | At or above 1000 ms and below 3000 ms.                                    |
| `Dead`      | `"dead"`      | At or above 3000 ms. A grade also uses this when the blamed path is down. |

A grade uses `Dead` when the blamed path is down. `latencyBand` returns `null` instead of `Dead` when the argument is not a finite duration of zero or more.

### `TrendInterpretation`

Frozen sentences returned by `interpretTrends`.

| Field          | Sentence                                                |
| -------------- | ------------------------------------------------------- |
| `ShortWindow`  | `Not enough samples to interpret the path.`             |
| `Isp`          | `The ISP path is down.`                                 |
| `Origin`       | `The origin is down or slow.`                           |
| `Edge`         | `The edge is down or slow. The origin is responding.`   |
| `Local`        | `The local API is down. The public API is responding.`  |
| `Intermittent` | `The path is mostly healthy, with intermittent faults.` |
| `Healthy`      | `The path is healthy.`                                  |

### `latencyBand(elapsedMs)`

Return the band for one duration.

| Argument    | Type   | Role                      |
| ----------- | ------ | ------------------------- |
| `elapsedMs` | number | Duration in milliseconds. |

The result is a `LatencyBand` string, or `null`.

1. Not a finite number, or negative: `null`. `NaN`, `Infinity`, a numeric string, `null`, and `undefined` are `null`.
2. Below `EXCELLENT_LATENCY_MS`: excellent.
3. Below `GOOD_LATENCY_MS`: good.
4. Below `FAIR_LATENCY_MS`: fair.
5. Below `POOR_LATENCY_MS`: poor.
6. Below `DEAD_LATENCY_MS`: bad.
7. Otherwise: dead.

Zero is excellent. `-0` is excellent. The cutoffs are inclusive on the lower side of the next band: `80` is good, `150` is fair, `500` is poor, `1000` is bad, and `3000` is dead.

### `isProbeUp(probe)`

Return `true` when the probe succeeded with a usable duration.

`probe` is up only when all of these hold:

- It is a non-array object.
- `ok` is strictly `true`. `1` and `"true"` are not up.
- `latencyBand(elapsedMs)` is a band other than dead.

`ok: false` stays down when the elapsed time is short. `ok: true` is down when the elapsed time is missing, not finite, negative, or at least `DEAD_LATENCY_MS`. A missing probe, `null`, and an array are down.

`classifySample` and `buildTrends` both use this rule.

### `classifySample(sample)`

Grade one sample.

`sample` must be a non-array object. Any other value throws `TypeError`.

| Field       | Type  | Role                                                      |
| ----------- | ----- | --------------------------------------------------------- |
| `dns`       | probe | Name resolution from this path. Omitted means down.       |
| `icmp`      | probe | Echo from this path. Omitted means down.                  |
| `localApi`  | probe | The API on the origin machine. Omitted means down.        |
| `publicApi` | probe | The same API through the public edge. Omitted means down. |

A probe is `{ ok, elapsedMs }`, as defined for `isProbeUp`. Extra fields on the sample and on a probe are ignored. They are not copied onto the grade.

The return value is `{ cause, band, latencyMs }`.

| Field       | Type             | Meaning                                                         |
| ----------- | ---------------- | --------------------------------------------------------------- |
| `cause`     | string           | A `PathCause` string.                                           |
| `band`      | string           | A `LatencyBand` string. `dead` when the blamed path is down.    |
| `latencyMs` | number or `null` | The elapsed time the grade used. `null` when that path is down. |

The checks run in this order. The first match wins.

1. DNS is down and ICMP is down: `isp`, band `dead`, latency `null`. The API probes are not consulted. This still applies when both APIs answered, and when both APIs failed.
2. The local API is down and the public API is down: `origin`, band `dead`, latency `null`. This still applies when both ISP probes are up, and when only one ISP probe is down. One dead ISP probe is not an ISP outage.
3. The local API is up and the public API is down: `edge`, band `dead`, latency `null`. A slow local reading does not change this. A dead public edge is not an origin fault.
4. The local API is down and the public API is up: `local`, band `dead`, latency `null`. The public path answered, so this is not an origin outage and not an edge outage.
5. The local API is up and its elapsed time is at or above `FAIR_LATENCY_MS`: `origin`, the band of that local elapsed time, and that elapsed time. This still applies when the public API is slow, and when DNS or ICMP is slow. A slow origin is not an ISP fault.
6. The public API is up and its elapsed time is at or above `FAIR_LATENCY_MS`: `edge`, the band of that public elapsed time, and that elapsed time. The local API is already up and under 500 ms.
7. Otherwise: `clear`, the band of the public elapsed time, and that elapsed time. A clear band is the public latency, not the worse of the two APIs.

An empty object is `isp`, because every omitted probe is down, and the ISP check is first.

### `percentile(values, p)`

Nearest-rank percentile of the finite numbers in `values`.

| Argument | Type   | Role                                                                      |
| -------- | ------ | ------------------------------------------------------------------------- |
| `values` | array  | Numbers. Non-finite values, and values that are not numbers, are dropped. |
| `p`      | number | Rank from 0 through 100, inclusive.                                       |

`values` must be an array. Any other argument throws `TypeError`. `p` must be a finite number from 0 through 100. Any other `p` throws `RangeError`.

The input array is not sorted in place and is not mutated. An empty list, or a list with no finite numbers, returns `null`.

Let `count` be the number of finite values after they are sorted ascending. The rank is `ceil(p * count / 100)`, and a rank of 0 is treated as 1. The result is the value at that 1-based rank. `0` returns the minimum. `100` returns the maximum. Negatives and zero are kept. This function does not apply the latency cutoffs. `buildTrends` applies those before it calls `percentile`.

`percentile([10, 20, 30, 40], 50)` is `20`. `percentile([10, 20, 30, 40], 95)` is `40`. For the integers `1` through `100`, percentile `95` is `95`.

### `average(values)`

Arithmetic mean of the finite numbers in `values`.

`values` must be an array. Any other argument throws `TypeError`. Non-finite values, and values that are not numbers, are dropped. An empty contribution returns `null`. The input is not mutated. The result is not rounded. `average([10, NaN, 30])` is `20`.

### `buildTrends(samples)`

Grade a window and summarize it.

| Argument  | Type  | Role                                                                                               |
| --------- | ----- | -------------------------------------------------------------------------------------------------- |
| `samples` | array | Raw samples, in window order. Oldest first is conventional. The order is the order used for flaps. |

`samples` must be an array. Any other value throws `TypeError`. An empty array is a valid window. Each entry is passed to `classifySample`. One entry that is not a sample throws, and no trends object is returned.

The return value:

| Field     | Type   | Meaning                                                                                                                            |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `count`   | number | `samples.length`, including samples whose probes were down.                                                                        |
| `rates`   | object | One key per `PATH_CAUSES` string. Each value is `countForCause / count`, or `0` when the window is empty.                          |
| `flaps`   | number | How many times the cause changed from one sample to the next. A single sample flaps `0`. A band change inside one cause flaps `0`. |
| `latency` | object | Keys `dns`, `icmp`, `localApi`, and `publicApi`.                                                                                   |

Each latency entry is `{ count, averageMs, p50Ms, p95Ms }`.

| Field       | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `count`     | How many samples had that probe up.                            |
| `averageMs` | `average` of those elapsed times, or `null` when none were up. |
| `p50Ms`     | `percentile` at `P50`, or `null` when none were up.            |
| `p95Ms`     | `percentile` at `P95`, or `null` when none were up.            |

Down probes are omitted from the latency numbers. A timeout does not become a `0`, and it does not become `3000`, inside the average or the percentile. The rate carries the outage. The percentile describes the probes that were up.

Five up DNS readings of `10`, `20`, `30`, `40`, and `100`, plus one down DNS reading, give `count` `5`, `averageMs` `40`, `p50Ms` `30`, and `p95Ms` `100`.

### `interpretTrends(trends)`

Return one sentence for a trends object.

| Argument | Type   | Role                                                                         |
| -------- | ------ | ---------------------------------------------------------------------------- |
| `trends` | object | The `count` and `rates` fields from `buildTrends`. Other fields are ignored. |

`trends` must be a non-array object. `count` must be a non-negative integer. Once `count` is at least `TREND_MIN_SAMPLES`, `rates` must be an object with every `PATH_CAUSES` key set to a finite number from 0 through 1. A bad shape throws `TypeError`.

The checks run in this order. The first match wins.

1. `count` is below `TREND_MIN_SAMPLES`: the short-window sentence. A window of four ISP outages does not say the ISP path is down.
2. `rates.isp` is at least `DOMINANT_FAULT_RATE`: the ISP sentence.
3. `rates.origin` is at least `DOMINANT_FAULT_RATE`: the origin sentence. Down and slow share this sentence.
4. `rates.edge` is at least `DOMINANT_FAULT_RATE`: the edge sentence.
5. `rates.local` is at least `DOMINANT_FAULT_RATE`: the local sentence.
6. Any fault rate is greater than 0: the intermittent sentence.
7. Otherwise: the healthy sentence.

An even split of `0.5` and `0.5` names the earlier cause in that list. The sentence does not read `latency`. A healthy rate says the path is healthy even if a caller attaches a high percentile. Real output from `buildTrends` cannot do that: every clear sample has a public latency below 500 ms.

### `createCounters()`

Return a new counter object:

```js
{
  lastCause: null,
  flaps: 0,
  counts: { clear: 0, isp: 0, origin: 0, edge: 0, local: 0 }
}
```

Each call returns new objects. The counters are optional. A caller that only wants a window can use `buildTrends` and never call this.

### `updateCounters(counters, sample)`

Fold one sample into the flap counters.

| Argument   | Type             | Role                                                                             |
| ---------- | ---------------- | -------------------------------------------------------------------------------- |
| `counters` | object or `null` | The previous return value. `null` and `undefined` start from `createCounters()`. |
| `sample`   | object           | One raw sample, graded with `classifySample`.                                    |

The return value is a new object. `counters` and `counters.counts` are not mutated.

| Field       | Meaning                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `lastCause` | The cause of this sample.                                                                                   |
| `flaps`     | The previous flap total, plus one when `lastCause` was already set and this cause differs.                  |
| `counts`    | A new object. The previous total for this cause, plus one. Unknown keys on the previous counts are dropped. |

Omitted `flaps`, `lastCause`, and `counts` are read as zero, `null`, and zero totals. `lastCause` must be `null`, `undefined`, or a `PathCause` string. The key name `"Clear"` is rejected. `flaps` and each stored total must be a non-negative integer when present. `counters` itself must be `null`, `undefined`, or a non-array object. A bad counters object throws `TypeError` before the sample is graded. A bad sample throws the `classifySample` error.

A change from poor to bad, both `origin`, does not flap. A change from `origin` to `edge` does. Feeding a window through `updateCounters` in order produces the same `flaps` value as `buildTrends`, and the same per-cause totals.

## Design notes

The grade is a decision table with a fixed bias. It exists so two mistakes stay rare. A slow origin must not be labeled as the ISP. A dead public edge must not be labeled as the origin.

The ISP row is narrow on purpose. DNS can fail while the path still carries traffic. ICMP is often filtered. Either one, alone, is not the ISP path. Both down is the ISP path, and that row wins before the API rows, including when the APIs also failed and including when the APIs still answered. There is no "ISP is slow" cause. A slow echo with a fast local API and a fast public API stays `clear`. The slow echo is still visible: `buildTrends` puts it in `latency.icmp`. A slow local API stays `origin` when DNS and ICMP are slow too. The ISP percentile can show the slow probes without taking the blame.

The origin row is the pair of API failures, and it is also a slow local reading. It does not require the ISP probes to be healthy. Both APIs down, with only ICMP down, is still the origin. A local reading at 500 ms is already slow. The public reading does not have to be slow for that to be true. If the public reading is slow as well, the cause is still the origin, because the machine itself is slow. Step 3 is the exception: if the public API is down and the local API is up, the grade is `edge` even when the local reading is slow. The dead edge is the outage. The local slowness remains in `latency.localApi`.

The edge row is the public path failing, or running slow, while the origin reading is up and under 500 ms. That split is the whole point of taking a local reading and a public reading. The local success is what clears the machine.

`local` is the remaining cell. The public API answered and the local API did not. Calling that `origin` would say the machine is down while the public path is serving. Calling it `edge` would blame the path that worked.

`clear` uses the public elapsed time because that is the duration a caller outside the machine waited. A local reading of 400 ms and a public reading of 40 ms is excellent. A local reading of 40 ms and a public reading of 400 ms is fair. Neither is a fault. The fault line is 500 ms, the poor band, not the excellent band.

`ok` and the dead cutoff answer different questions. `ok: false` is the probe reporting failure. A short elapsed time does not overrule it. `ok: true` with an elapsed time of 3000 ms or more is not a usable success, so the probe is down anyway. A missing elapsed time is down for the same reason.

The window does not grade again inside `interpretTrends`. Each sample has one cause, so each rate is that cause's count divided by the window length. The five rates are a partition of the window. In floating point their sum can miss 1 by a fraction of a unit in the last place. Multiplying each rate by `count` recovers the integer totals. The sentence wants a majority, and an even 0.5 counts. The order of the majority checks is the same bias as the sample grade: ISP, then origin, then edge, then local. Below five samples the function refuses, so two bad readings cannot sound like a conclusion. Flaps count cause changes only. A drift from poor to bad is the same fault getting worse, not a new fault.

Percentiles skip probes that are down so a dead window does not look like a latency problem and a latency problem does not look like a handful of zeros. If every DNS probe failed, `latency.dns.count` is `0` and the percentile is `null`. The ISP rate, or the other rates, carry that failure.

This module does not open sockets, send probes, read the clock, store samples, or decide to repair a path. It does not accept host names, addresses, or URLs as inputs that affect the grade. The caller chooses what the four probes mean, how often to sample, and which samples belong in one window.

## License

Released under the MIT License. The full text is in [LICENSE](LICENSE).
