/* The analysis of geometry.js off the page's thread: a second or so of
 * work on half a million pixels is a second the view would stand still.
 * A GLB in, what analyse() makes of it out, its arrays handed over rather
 * than copied. */

import { analyse, readGrid } from "./geometry.js";

self.onmessage = (event) => {
  const { id, buffer } = event.data;
  try {
    const result = analyse(readGrid(buffer));
    self.postMessage({ id, result }, [result.labels.buffer, result.dist.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String((error && error.message) || error) });
  }
};
