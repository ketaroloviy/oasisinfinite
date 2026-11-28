// Список валют игры. Админ-панель строится из этого списка.
// Новая валюта: добавь сюда одну строку (key = поле в состоянии игрока на сервере).
import { MAX_LEVEL } from './core.js';

export const CURRENCIES = [
  { id: 'gold',    name: 'Золото',    key: 'gold',    int: false, min: 0, max: 1e15 },
  { id: 'xp',      name: 'Опыт',      key: 'xp',      int: false, min: 0, max: 1e12 },
  { id: 'level',   name: 'Уровень',   key: null,      int: true,  min: 1, max: MAX_LEVEL, isLevel: true },
  { id: 'nuggets', name: 'Самородки', key: 'nuggets', int: true,  min: 0, max: 1e12 },
  { id: 'aksum',   name: 'Аксумм',    key: 'aksum',   int: false, min: 0, max: 1e15 },
];
