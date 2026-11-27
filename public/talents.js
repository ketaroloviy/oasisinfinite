// Древо талантов рудника. Общий файл: сервер проверяет покупки, клиент рисует экран.
// Цены и уровни задаются тирами; поправить баланс можно в таблицах ниже.

export const TIERS = [
  { level: 1,  gold: 50 },
  { level: 3,  gold: 200 },
  { level: 5,  gold: 600 },
  { level: 7,  gold: 1800 },
  { level: 9,  gold: 5000 },
  { level: 12, gold: 15000 },
  { level: 15, gold: 45000 },
  { level: 18, gold: 140000 },
  { level: 22, gold: 420000 },
  { level: 26, gold: 1300000 },
];
export const FINAL = { level: 30, gold: 5000000 };

// effect: clickBonus и minerSpeed и xpBonus складываются, clickMult и goldMult перемножаются.
const BRANCHES = [
  {
    id: 'pick', name: 'Кирка', desc: 'Золото за клик', firstTier: 1,
    nodes: [
      ['Острое лезвие', 'clickBonus', 0.15], ['Крепкая рукоять', 'clickBonus', 0.15],
      ['Закалённая сталь', 'clickBonus', 0.20], ['Точный удар', 'clickBonus', 0.20],
      ['Двойной замах', 'clickBonus', 0.25], ['Рудный нюх', 'clickBonus', 0.25],
      ['Жильный резонанс', 'clickBonus', 0.30], ['Мощь предков', 'clickBonus', 0.30],
      ['Удар по жиле', 'clickBonus', 0.40], ['Золотая кирка', 'clickMult', 2],
    ],
  },
  {
    id: 'crew', name: 'Артель', desc: 'Скорость шахтёров', firstTier: 1,
    nodes: [
      ['Тележки', 'minerSpeed', 0.10], ['Фонари', 'minerSpeed', 0.10],
      ['Подпорки', 'minerSpeed', 0.10], ['Вентиляция', 'minerSpeed', 0.15],
      ['Рельсы', 'minerSpeed', 0.15], ['Бригадир', 'minerSpeed', 0.15],
      ['Сменный график', 'minerSpeed', 0.20], ['Подъёмник', 'minerSpeed', 0.20],
      ['Взрывные работы', 'minerSpeed', 0.25], ['Штольни', 'minerSpeed', 0.50],
    ],
  },
  {
    id: 'vault', name: 'Казна', desc: 'Всё золото', firstTier: 3,
    nodes: [
      ['Сундук', 'goldMult', 1.10], ['Весы', 'goldMult', 1.10],
      ['Хранилище', 'goldMult', 1.15], ['Караван', 'goldMult', 1.15],
      ['Торговая жила', 'goldMult', 1.20], ['Золотой запас', 'goldMult', 1.20],
      ['Оазисный налог', 'goldMult', 1.30], ['Сокровищница', 'goldMult', 1.50],
    ],
  },
  {
    id: 'know', name: 'Знания', desc: 'Опыт', firstTier: 1,
    nodes: [
      ['Записная книжка', 'xpBonus', 0.05], ['Карта жил', 'xpBonus', 0.05],
      ['Старший товарищ', 'xpBonus', 0.10], ['Опыт поколений', 'xpBonus', 0.10],
      ['Горный устав', 'xpBonus', 0.10], ['Школа рудокопов', 'xpBonus', 0.15],
      ['Мастер-класс', 'xpBonus', 0.15], ['Наставник', 'xpBonus', 0.20],
      ['Легенда рудника', 'xpBonus', 0.20],
    ],
  },
];

// Дополнительные требования между ветками.
const CROSS = {
  vault_3: ['pick_2', 'crew_2'],
  pick_6: ['crew_4'],
  crew_6: ['pick_4'],
  know_5: ['pick_3'],
};

const pct = (v) => Math.round(v * 100);
const times = (v) => '×' + String(v).replace('.', ',');

export function effectText(type, value) {
  switch (type) {
    case 'clickBonus': return '+' + pct(value) + '% золота за клик';
    case 'clickMult': return 'Золото за клик ' + times(value);
    case 'minerSpeed': return '+' + pct(value) + '% скорости шахтёров';
    case 'goldMult': return 'Всё золото ' + times(value);
    case 'xpBonus': return '+' + pct(value) + '% опыта';
    default: return '';
  }
}

export const NODES = [];

for (const br of BRANCHES) {
  br.nodes.forEach(([name, type, value], i) => {
    const tier = br.firstTier + i;
    const id = br.id + '_' + tier;
    const prev = i > 0 ? [br.id + '_' + (tier - 1)] : [];
    NODES.push({
      id, branch: br.id, tier, name,
      effect: { type, value },
      text: effectText(type, value),
      req: [...prev, ...(CROSS[id] || [])],
      level: TIERS[tier - 1].level,
      cost: { gold: TIERS[tier - 1].gold },
    });
  });
}

// Алмазные таланты (за самородки).
NODES.push(
  {
    id: 'dia_1', branch: 'dia', tier: 0, name: 'Алмазный нюх',
    effect: { type: 'doubleNugget', value: 0.01 },
    text: '+1% шанс удвоить выпавшие самородки',
    req: ['pick_4', 'crew_4'], level: 12, cost: { nuggets: 30 },
  },
  {
    id: 'dia_2', branch: 'dia', tier: 0, name: 'Алмазная лихорадка',
    effect: { type: 'fever', value: 1 },
    text: 'После алмазной жилы на 60 с: золото за клик и шахтёры ×2',
    req: ['dia_1', 'pick_7'], level: 20, cost: { nuggets: 70 },
  },
  {
    id: 'dia_3', branch: 'dia', tier: 0, name: 'Король рудника',
    effect: { type: 'goldMult', value: 1.5 },
    text: 'Всё золото ×1,5 навсегда',
    req: ['dia_2', 'pick_10'], level: 26, cost: { nuggets: 150 },
  },
);

// Финальный нод: нужны все остальные.
NODES.push({
  id: 'final', branch: 'final', tier: 0, name: 'Ключ от плавильни',
  effect: { type: 'unlock', value: 1 },
  text: 'Открывает плавильню',
  req: NODES.map((n) => n.id), level: FINAL.level, cost: { gold: FINAL.gold },
});

export const NODE_BY_ID = Object.fromEntries(NODES.map((n) => [n.id, n]));

export const BRANCH_INFO = [
  ...BRANCHES.map((b) => ({ id: b.id, name: b.name, desc: b.desc })),
  { id: 'dia', name: 'Алмазные таланты', desc: 'Покупаются за самородки' },
  { id: 'final', name: 'Финал', desc: 'Нужны все остальные таланты' },
];

// Можно ли купить нод. Возвращает null или код причины.
export function checkBuy(node, owned, level, gold, nuggets) {
  if (owned.includes(node.id)) return 'owned';
  if (node.req.some((r) => !owned.includes(r))) return 'requires';
  if (level < node.level) return 'level';
  const have = node.cost.nuggets !== undefined ? nuggets : gold;
  const need = node.cost.nuggets !== undefined ? node.cost.nuggets : node.cost.gold;
  if (have < need) return 'funds';
  return null;
}

// Итоговые бонусы игрока по списку купленных нодов.
export function computeMods(owned, mine) {
  let clickBonus = 0, clickMult = 1, minerSpeed = 0, goldMult = 1, xpBonus = 0, doubleNugget = 0;
  let fever = false;
  for (const id of owned) {
    const n = NODE_BY_ID[id];
    if (!n) continue;
    const { type, value } = n.effect;
    if (type === 'clickBonus') clickBonus += value;
    else if (type === 'clickMult') clickMult *= value;
    else if (type === 'minerSpeed') minerSpeed += value;
    else if (type === 'goldMult') goldMult *= value;
    else if (type === 'xpBonus') xpBonus += value;
    else if (type === 'doubleNugget') doubleNugget += value;
    else if (type === 'fever') fever = true;
  }
  return {
    clickGold: mine.baseClickGold * (1 + clickBonus) * clickMult * goldMult,
    minerGold: mine.minerBaseRate * (1 + minerSpeed) * goldMult,
    xpMult: 1 + xpBonus,
    doubleNugget,
    fever,
  };
}
