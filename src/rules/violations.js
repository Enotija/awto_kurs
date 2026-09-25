// Каталог нарушений. severity: 'critical' — на экзамене сразу «не сдал»,
// 'minor' — ошибка; повтор той же ошибки на экзамене — «не сдал».

export const VIOLATIONS = {
  SPEEDING: { severity: 'minor', ru: 'Превышение скорости', pl: 'Przekroczenie dozwolonej prędkości' },
  SPEEDING_HARD: { severity: 'critical', ru: 'Сильное превышение скорости (больше чем на 10 км/ч)', pl: 'Znaczne przekroczenie prędkości' },
  RED_LIGHT: { severity: 'critical', ru: 'Проезд на красный свет', pl: 'Wjazd za sygnalizator przy czerwonym świetle' },
  ARROW_NO_STOP: { severity: 'critical', ru: 'Зелёная стрелка: поворот без полной остановки', pl: 'Zielona strzałka — brak zatrzymania' },
  STOP_SIGN: { severity: 'critical', ru: 'Знак STOP: не было полной остановки', pl: 'Niezatrzymanie się przed znakiem STOP' },
  NO_SIGNAL: { severity: 'minor', ru: 'Манёвр без поворотника', pl: 'Brak sygnalizacji zamiaru wykonania manewru' },
  NO_MIRROR: { severity: 'minor', ru: 'Манёвр без взгляда в зеркало', pl: 'Brak obserwacji w lusterkach przed manewrem' },
  WRONG_SIDE: { severity: 'critical', ru: 'Езда по встречной полосе', pl: 'Jazda lewą stroną jezdni' },
  CURB: { severity: 'minor', ru: 'Наезд на бордюр', pl: 'Najechanie na krawężnik' },
  // Этап 3 — живой город
  PRIORITY: { severity: 'critical', ru: 'Не уступил дорогу (помеха)', pl: 'Wymuszenie pierwszeństwa przejazdu' },
  PEDESTRIAN: { severity: 'critical', ru: 'Не пропустил пешехода на переходе', pl: 'Nieustąpienie pierwszeństwa pieszemu' },
  CYCLIST_GAP: { severity: 'critical', ru: 'Опасный обгон велосипедиста (ближе 1 м)', pl: 'Wyprzedzanie rowerzysty w odległości mniejszej niż 1 m' },
  COLLISION: { severity: 'critical', ru: 'Столкновение', pl: 'Kolizja / spowodowanie zagrożenia' },
};

export const MANEUVER_RU = {
  left: 'поворот налево', right: 'поворот направо', roundabout: 'съезд с кольца',
  start: 'трогание от края дороги', uturn: 'разворот',
};
