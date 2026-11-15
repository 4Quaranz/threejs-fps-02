// FROSTLINE — round economy.
// Money is earned per round and per kill, and spent in the buy menu. The
// losing side gets a growing loss bonus so a match never snowballs into a
// rout. All amounts are in dollars; the HUD shows them as $.
export const ECON = {
  winRound: 3250,
  loseRound: 1900,
  lossStreakBonus: 500,
  lossStreakCap: 1500,
  kill: 300,
  plant: 300,
  startMoney: 800,
};

export function awardRoundEnd(econ, winnerTeam, playerTeam) {
  if (winnerTeam === playerTeam) {
    econ.money += ECON.winRound;
    econ.lossStreak = 0;
    return { amount: ECON.winRound, reason: 'round win' };
  }
  const bonus = Math.min(econ.lossStreak * ECON.lossStreakBonus, ECON.lossStreakCap);
  const amount = ECON.loseRound + bonus;
  econ.money += amount;
  econ.lossStreak += 1;
  return { amount, reason: bonus > 0 ? 'round loss + streak' : 'round loss' };
}

export function awardKill(econ) {
  econ.money += ECON.kill;
  return ECON.kill;
}

export function awardPlant(econ) {
  econ.money += ECON.plant;
  return ECON.plant;
}

// Returns true when the purchase went through.
export function tryBuy(econ, price) {
  if (price <= 0) return true;
  if (econ.money < price) return false;
  econ.money -= price;
  return true;
}
