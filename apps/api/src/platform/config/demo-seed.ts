/**
 * Whether the built-in demo dataset is loaded.
 *
 * A real factory installation starts empty and fills up from its own master
 * data; shipping a fictional tyre plant into it would leave someone deleting
 * plants, machines and work orders by hand before they can begin. A sales or
 * pilot deployment wants the opposite, a console with something to show.
 *
 * One environment variable decides:
 *
 *     SEED_DEMO_DATA=true    demo tyre plant, 60 days of shop-floor history
 *     SEED_DEMO_DATA unset   empty install, only the bootstrap administrator
 *
 * Off by default, because the safe failure is an empty screen a customer can
 * fill, not fictional production data they might mistake for their own.
 */
export const SEED_DEMO_DATA = /^(1|true|yes)$/i.test(process.env.SEED_DEMO_DATA ?? '');

/**
 * Returns the demo rows when seeding is on, and an empty collection otherwise.
 *
 * Written as a function taking a thunk so the data is not even constructed on
 * a production install.
 */
export function demoRows<T>(rows: () => T[]): T[] {
  return SEED_DEMO_DATA ? rows() : [];
}
