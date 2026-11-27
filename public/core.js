// Общая логика для сервера и клиента. Здесь нет секретов:
// случайные числа всегда приходят снаружи (на сервере это настоящая случайность).

export const MAX_LEVEL = 60;

// Опыт, нужный для перехода с уровня level на следующий.
export function xpToNext(level) {
  return Math.round(25 * Math.pow(level, 1.6));
}

// По общему опыту возвращает уровень, опыт внутри уровня и сколько нужно до следующего.
export function levelInfo(xp) {
  let level = 1;
  let rest = xp;
  while (level < MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: xpToNext(level) };
}

// Выбор элемента из списка по весам chance.
export function rollWeighted(list, rand) {
  const total = list.reduce((sum, v) => sum + v.chance, 0);
  let r = rand() * total;
  for (const v of list) {
    if (r < v.chance) return v.id;
    r -= v.chance;
  }
  return list[0].id;
}

// Выбор типа жилы по шансам из баланса.
export function rollVein(mine, rand) {
  return rollWeighted(mine.veins, rand);
}

// Дополняет очередь будущих жил до нужной длины.
export function refillQueue(queue, mine, rand) {
  while (queue.length < mine.queueSize) queue.push(rollVein(mine, rand));
}

// Применяет k кликов к состоянию s: { gold, xp, nuggets, queue, hits }.
// rollNuggets([min, max]) возвращает число самородков (на клиенте это заглушка).
export function applyClicks(s, k, mine, mods, rollNuggets) {
  const gained = { gold: 0, xp: 0, nuggets: 0, broken: 0 };
  for (let i = 0; i < k; i++) {
    if (s.queue.length === 0) break;
    const vein = mine.veins[s.queue[0]];

    if (vein.mult > 0) {
      const g = mods.clickGold * vein.mult;
      s.gold += g;
      gained.gold += g;
    }
    const x = mine.xpPerClick * mods.xpMult;
    s.xp += x;
    gained.xp += x;

    s.hits += 1;
    if (s.hits >= mine.clicksPerVein) {
      if (vein.nuggets) {
        const n = rollNuggets(vein.nuggets);
        s.nuggets += n;
        gained.nuggets += n;
      }
      s.queue.shift();
      s.hits = 0;
      gained.broken += 1;
    }
  }
  return gained;
}

// Цена следующего шахтёра, если уже нанято owned.
export function minerPrice(mine, owned) {
  return Math.round(mine.minerBaseCost * Math.pow(mine.minerGrowth, owned));
}

// Суммарная цена найма count шахтёров подряд, если уже нанято owned.
export function minersCost(mine, owned, count) {
  let total = 0;
  for (let i = 0; i < count; i++) total += minerPrice(mine, owned + i);
  return total;
}

// Цена следующего рабочего (шахтёра или кузнеца).
export function workerPrice(baseCost, growth, owned) {
  return Math.round(baseCost * Math.pow(growth, owned));
}

// Суммарная цена найма count рабочих подряд, если уже нанято owned.
export function workersCost(baseCost, growth, owned, count) {
  let total = 0;
  for (let i = 0; i < count; i++) total += workerPrice(baseCost, growth, owned + i);
  return total;
}
