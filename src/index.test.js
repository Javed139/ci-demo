'use strict';

/**
 * Lightweight test runner – no external dependencies required.
 * Runs as part of `npm test` in the CI pipeline.
 */

const { add, greet, healthCheck } = require('./index');

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✅  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌  FAIL: ${description}`);
    failed++;
  }
}

function assertThrows(description, fn) {
  try {
    fn();
    console.error(`  ❌  FAIL: ${description} (expected an error but none was thrown)`);
    failed++;
  } catch (_) {
    console.log(`  ✅  PASS: ${description}`);
    passed++;
  }
}

// ── Test Suite ──────────────────────────────────────────────
console.log('\n🧪  Running Unit Tests\n');

console.log('add()');
assert('adds two positive numbers', add(2, 3) === 5);
assert('adds negative numbers', add(-1, -2) === -3);
assert('adds zero', add(0, 0) === 0);

console.log('\ngreet()');
assert('returns correct greeting', greet('World') === 'Hello, World!');
assertThrows('throws on empty string', () => greet(''));
assertThrows('throws on non-string', () => greet(42));

console.log('\nhealthCheck()');
const hc = healthCheck();
assert('status is ok', hc.status === 'ok');
assert('timestamp is a string', typeof hc.timestamp === 'string');
assert('timestamp is a valid date', !isNaN(Date.parse(hc.timestamp)));

// ── Summary ──────────────────────────────────────────────────
console.log(`\n📊  Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
