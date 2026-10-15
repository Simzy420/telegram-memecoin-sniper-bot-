import assert from 'node:assert/strict';
import test from 'node:test';
import { BOT_ROSTER } from '../../bots/roster.ts';
import {
  BOT_ORBITS,
  PLANETS,
  REFERENCE_BOX,
  STILL_TIME,
  cometState,
  projectBody,
} from './solarSystemModel.ts';

test('orbital periods increase with distance', () => {
  for (let i = 1; i < PLANETS.length; i += 1) {
    assert.ok(PLANETS[i].au > PLANETS[i - 1].au);
    assert.ok(PLANETS[i].period > PLANETS[i - 1].period);
  }
});

test('a full period returns each planet to its start', () => {
  for (const planet of PLANETS) {
    const start = projectBody(planet, 3, REFERENCE_BOX.width, REFERENCE_BOX.height, 0);
    const lap = projectBody(planet, 3 + planet.period, REFERENCE_BOX.width, REFERENCE_BOX.height, 0);
    assert.ok(Math.abs(start.x - lap.x) < 1e-6, planet.id);
    assert.ok(Math.abs(start.y - lap.y) < 1e-6, planet.id);
  }
});

test('motion is counter-clockwise on screen', () => {
  const spec = { id: 'probe', au: 1, period: 10, phase: 0 };
  const start = projectBody(spec, 0, 300, 300, 0);
  const next = projectBody(spec, 0.15, 300, 300, 0);
  assert.ok(next.y < start.y);
  assert.ok(next.x < start.x);
});

test('every roster bot has an orbit among the planets', () => {
  for (const bot of BOT_ROSTER) {
    const orbit = BOT_ORBITS.find((entry) => entry.id === bot.id);
    assert.ok(orbit, bot.id);
    assert.ok(orbit.au > PLANETS[0].au);
    assert.ok(orbit.au < PLANETS[PLANETS.length - 1].au);
  }
});

test('the still frame keeps planets from stacking', () => {
  const points = PLANETS.map((planet) => ({
    id: planet.id,
    ...projectBody(planet, STILL_TIME, REFERENCE_BOX.width, REFERENCE_BOX.height, 0),
  }));
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = ((points[i].x - points[j].x) / 100) * REFERENCE_BOX.width;
      const dy = ((points[i].y - points[j].y) / 100) * REFERENCE_BOX.height;
      const distance = Math.hypot(dx, dy);
      assert.ok(distance > 16, `${points[i].id} and ${points[j].id} are ${distance.toFixed(1)}px apart`);
    }
  }
});

test('the comet stays on a bound ellipse', () => {
  for (let time = 0; time < 24; time += 0.4) {
    const comet = cometState(time, REFERENCE_BOX.width, REFERENCE_BOX.height, 0);
    assert.ok(comet.au > 0.08 && comet.au < 1.15, `au ${comet.au} at t=${time}`);
    assert.ok(Number.isFinite(comet.x) && Number.isFinite(comet.y));
  }
});
