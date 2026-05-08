'use strict';

/**
 * Simple API utility module used for CI/CD demo purposes.
 * Demonstrates basic functionality that can be linted and tested.
 */

/**
 * Adds two numbers together.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function add(a, b) {
  return a + b;
}

/**
 * Returns a greeting string.
 * @param {string} name
 * @returns {string}
 */
function greet(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Name must be a non-empty string');
  }
  return `Hello, ${name}!`;
}

/**
 * Simulates a health-check endpoint response.
 * @returns {{ status: string, timestamp: string }}
 */
function healthCheck() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString()
  };
}

module.exports = { add, greet, healthCheck };

// Entry-point log when run directly
if (require.main === module) {
  console.log('App started:', healthCheck());
}
