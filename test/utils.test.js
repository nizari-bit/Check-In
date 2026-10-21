import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, normalizeCode, capacityOf, parseCardType, clean, eventExpiry, isEventAccessOpen } from '../src/utils.js';

test('generateCode makes IDs like A3F-9C2', () => {
  for (let i = 0; i < 50; i++) assert.match(generateCode(), /^[0-9A-F]{3}-[0-9A-F]{3}$/);
});

test('normalizeCode accepts messy input', () => {
  assert.equal(normalizeCode('a3f9c2'), 'A3F-9C2');
  assert.equal(normalizeCode('a3f-9c2'), 'A3F-9C2');
  assert.equal(normalizeCode('  A3F 9C2 '), 'A3F-9C2');
});

test('normalizeCode rejects bad input', () => {
  assert.equal(normalizeCode(''), null);
  assert.equal(normalizeCode(null), null);
  assert.equal(normalizeCode('A3F-9C'), null);
  assert.equal(normalizeCode('A3F-9C2D'), null);
});

test('single card admits 1 person, double admits 2', () => {
  assert.equal(capacityOf('single'), 1);
  assert.equal(capacityOf('double'), 2);
  assert.equal(capacityOf(undefined), 1);
});

test('parseCardType understands common words', () => {
  for (const v of ['double', 'DOUBLE', '2', 'couple', 'plus one', '+1']) assert.equal(parseCardType(v), 'double');
  for (const v of ['single', '', 'vip', undefined]) assert.equal(parseCardType(v), 'single');
});

test('clean trims, limits length and returns null for empty', () => {
  assert.equal(clean('  hi  '), 'hi');
  assert.equal(clean('   '), null);
  assert.equal(clean(undefined), null);
  assert.equal(clean('abcdef', 3), 'abc');
});

test('event link stays open until the end of the day after the event', () => {
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  assert.equal(isEventAccessOpen({ access_active: 1, event_date: day(0) }), true);   // today
  assert.equal(isEventAccessOpen({ access_active: 1, event_date: day(-1) }), true);  // yesterday: still open
  assert.equal(isEventAccessOpen({ access_active: 1, event_date: day(-3) }), false); // long past
  assert.equal(isEventAccessOpen({ access_active: 0, event_date: day(0) }), false);  // switched off
  assert.ok(eventExpiry({ event_date: '2030-01-01' }) instanceof Date);
});
