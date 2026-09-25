// Кто кому уступает на перекрёстке (польские правила, правостороннее движение).
// Участник: { arm — откуда въезжает, conn — id связки через перекрёсток, onArrow — едет
// по зелёной стрелке на красный, onRing — уже на кольце }.
// mustYield(node, a, b) → true, если a обязан уступить b.

import { OPPOSITE, RIGHT_ARM } from '../world/roadNetwork.js';

const isMain = (c) => c.type === 'priority' || c.type === 'none' || c.type === 'signals';

export function pathsCross(node, a, b) {
  if (a.arm === b.arm) return false;
  return node.conflicts[a.conn]?.has(b.conn) ?? false;
}

export function mustYield(node, a, b, net) {
  if (a.arm === b.arm) return false; // одна полоса — просто держим дистанцию
  if (node.kind === 'roundabout') return !!b.onRing && !a.onRing;
  if (!pathsCross(node, a, b)) return false;

  const movA = net.laneById[a.conn].movement;
  const movB = net.laneById[b.conn].movement;
  const ca = node.control[a.arm], cb = node.control[b.arm];

  if (node.kind === 'signals') {
    // По зелёной стрелке уступаешь всем, у кого зелёный
    if (a.onArrow && !b.onArrow) return true;
    if (b.onArrow && !a.onArrow) return false;
    // Налево — уступи встречным, едущим прямо и направо
    return movA === 'left' && b.arm === OPPOSITE[a.arm] && movB !== 'left';
  }

  // Главная дорога важнее второстепенной (знаки D-1 / A-7 / B-20)
  const mainA = isMain(ca), mainB = isMain(cb);
  if (mainA !== mainB) return !mainA;

  // Одинаковый статус: встречный поворачивающий налево уступает
  if (b.arm === OPPOSITE[a.arm]) return movA === 'left' && movB !== 'left';
  // Помеха справа
  if (RIGHT_ARM[a.arm] === b.arm) return true;
  return false;
}
