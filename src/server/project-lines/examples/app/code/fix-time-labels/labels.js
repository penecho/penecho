// Which time labels fit under their dots. A label that would run into the one before it goes to a second row; when that row
// is taken too it is left out, and its time is still on the dot when you point at it.
function placeLabels(xs, width = 36, gap = 4) {
  const ends = [-Infinity, -Infinity];
  return xs.map(x => {
    const row = ends.findIndex(end => x - width / 2 >= end + gap);
    if (row >= 0) ends[row] = x + width / 2;
    return { x, row };
  });
}
if (typeof module === "object") module.exports = { placeLabels };
