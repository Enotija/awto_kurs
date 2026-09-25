// Слои рендера: кто что видит.
//  0 — мир (видят все камеры)
//  1 — кузов своей машины снаружи (видят только камеры боковых зеркал)
//  2 — салон (видят камера водителя и камера салонного зеркала)
//  3 — стёкла и корпуса зеркал (видит только водитель)
export const LAYER = { WORLD: 0, BODY: 1, CABIN: 2, DRIVER_ONLY: 3 };

export function setLayer(object, layer) {
  object.traverse((o) => o.layers.set(layer));
}
