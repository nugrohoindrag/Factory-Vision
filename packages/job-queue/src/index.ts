/**
 * The platform's job queue (Architecture §22.5, ADR-09).
 *
 * A contract, a self-hosted PostgreSQL implementation, and a runner that owns
 * no domain knowledge. The API and the worker both depend on this package so
 * they cannot drift.
 */
export * from './contract.js';
export * from './postgres-queue.js';
export * from './runner.js';
