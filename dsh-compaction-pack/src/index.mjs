/**
 * Package root: the Loader row that carries this bundle's browser half.
 *
 * The Host work lives in the `./tuning` and `./engine` subpath plugins, so this
 * entry stays empty; a package root with real Host behaviour would be mounted
 * twice when its client row and its service row share the same specifier.
 */

/** Host plugin body: no host-side behaviour for the UI anchor row. */
export function apply() {}
