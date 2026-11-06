(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory([
    ...require('./levels-007-030'), ...require('./levels-031-055'),
    ...require('./levels-056-080'), ...require('./levels-081-100')
  ]);
  else root.AdventureLevels = factory(root.AdventureLevelPacks || []);
})(globalThis, function (packs) {
  const all = packs.flat().sort((a, b) => a.level - b.level);
  const byNumber = new Map(all.map(level => [level.level, level]));
  return { all, get: number => byNumber.get(number) };
});
