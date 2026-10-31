/**
 * Whether this build shows the views surfaces: the nav-row icon, the layer, the projection float, the
 * library tab and the two canvas rows that make a view.
 *
 * Views work, and they are not released. The feature pulls three states apart (a configuration the
 * workspace shares, a layer that reads it, a projection this reader casts) and that separation is right
 * but young, so the doors are shut in every build rather than in production only. `false` here is the
 * whole switch: mount the layer, the bar and the menu rows again and the surface returns, and a document
 * that already holds saved views keeps them, because nothing is deleted.
 *
 * A saved view is still readable data. A view card in an old document keeps drawing its figure, so pausing
 * the feature cannot blank a card somebody made.
 */
export const viewsEnabled: boolean = false;
