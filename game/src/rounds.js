// ECONOMY AND MATCH DESIGN — the money, and why it works this way.
//
// THE PAYOUTS. Round win +3250, round loss +1900, kill +300, plant +300.
// The player starts with $800: enough for a pistol round or a grenade, not
// a rifle. That gap is the whole economy — the buy menu matters because the
// rifle costs $2500 and the player cannot afford it in round one, and the
// loss payout matters because a lost round still pays $1900, so two losses
// buy a rifle. Without the loss payout the economy would snowball: the team
// that wins round one would out-gun the other forever.
//
// THE PRICES. Rifle $2500 is one won round ($3250) with change; SMG $1500
// is the half-buy after a loss; sniper $4000 needs a win plus a kill or a
// plant; grenade $300 is the spare-change buy. A player who wins, kills
// twice and plants has $3250 + $600 + $300 = $4150: a rifle, a grenade and
// money left over. The numbers are tuned so the choice is always real —
// there is no round where the correct buy is obvious.
//
// ROUND FLOW. buy (15 s) -> live (100 s) -> end (4 s banner) -> next buy.
// The buy phase is the only time the shop is open; bots do not buy, they
// keep the rifle, so the player's economy is the player's alone. The live
// timer stops while the bomb is planted and the 35 s bomb timer runs
// instead — the round cannot end on time while the bomb ticks, so a late
// plant is always worth attempting.
//
// END CONDITIONS. The round ends when one team is eliminated, the bomb
// detonates (attackers win), the bomb is defused (defenders win), or time
// expires (defenders win, unless the bomb is planted — then the bomb
// decides). First to 5 rounds wins the match; there is no overtime, so a
// 4–4 round is match point for both teams and the buy that round is the
// most expensive decision in the game.
// Rounds: the match state machine. One round is freeze (buy) -> live -> end,
// then the next round. The bomb is the objective; elimination is the fallback.
//
// ROUND FLOW
//   buy (15 s): both teams at spawn, the buy menu open for the player. The
//     player spends the money they earned. Bots do not buy; they keep the rifle.
//   live (100 s): the round timer runs. Attackers push a site; defenders hold.
//     The player plants the bomb by holding E inside a site (3 s channel).
//     A planted bomb beeps and detonates after 35 s. A defender defuses by
//     holding E beside the bomb (5 s channel). Moving or taking damage breaks
//     a channel.
//   end: the round ends when one team is eliminated, the bomb detonates
//     (attackers win), the bomb is defused (defenders win), or time expires
//     (defenders win, unless the bomb is planted). Money is paid out, the
//     score updates, and after a 4 s banner the next round starts. First to
//     5 rounds wins the match.
//
// MONEY
//   Round win +3250, round loss +1900, kill +300, plant +300. The player starts
//   with $800, enough for a pistol round or a grenade, not a rifle: the economy
//   is the reason the buy menu matters, and the reason a lost round still pays.
//
// THE BOMB
//   The player carries it (attackers only). Only the player can plant, because
//   the bots' job is to fight; a bot plant would take the objective out of the
//   player's hands. The plant site is whichever site the player stands in.
//   While the bomb is planted the round timer stops and the bomb timer runs.
//   Defenders are told (a banner and a sound) and rotate to the planted site.
export const ROUND = {
  BUY_SECONDS: 15,
  LIVE_SECONDS: 100,
  BOMB_SECONDS: 35,
  PLANT_SECONDS: 3,
  DEFUSE_SECONDS: 5,
  WIN_ROUNDS: 5,
  WIN_MONEY: 3250,
  LOSS_MONEY: 1900,
  KILL_MONEY: 300,
  PLANT_MONEY: 300,
  START_MONEY: 800,
};

export function createRounds() {
  const state = {
    phase: 'buy', // buy | live | end
    round: 1,
    timer: ROUND.BUY_SECONDS,
    bombTimer: 0,
    planted: false,
    plantedSite: null,
    plantProgress: 0,
    defuseProgress: 0,
    defusing: null,
    score: { attackers: 0, defenders: 0 },
    money: ROUND.START_MONEY,
    matchOver: false,
    winner: null,
    endReason: '',
    endTimer: 0,
  };

  return {
    state,
    startBuy() {
      state.phase = 'buy';
      state.timer = ROUND.BUY_SECONDS;
      state.planted = false;
      state.plantedSite = null;
      state.plantProgress = 0;
      state.defuseProgress = 0;
      state.defusing = null;
    },
    startLive() {
      state.phase = 'live';
      state.timer = ROUND.LIVE_SECONDS;
    },
    plant(site) {
      state.planted = true;
      state.plantedSite = site;
      state.bombTimer = ROUND.BOMB_SECONDS;
      state.plantProgress = 0;
      state.money += ROUND.PLANT_MONEY;
    },
    detonate() {
      state.planted = false;
      this.endRound('attackers', 'Bomb detonated');
    },
    defused() {
      state.planted = false;
      state.defuseProgress = 0;
      this.endRound('defenders', 'Bomb defused');
    },
    endRound(winner, reason) {
      if (state.phase === 'end') return;
      state.phase = 'end';
      state.endReason = reason;
      state.endTimer = 4;
      state.winner = winner;
      state.score[winner] += 1;
      if (winner === 'attackers') state.money += ROUND.WIN_MONEY;
      else state.money += ROUND.LOSS_MONEY;
      if (state.score[winner] >= ROUND.WIN_ROUNDS) {
        state.matchOver = true;
      }
    },
    addKillMoney() {
      state.money += ROUND.KILL_MONEY;
    },
    nextRound() {
      state.round += 1;
      this.startBuy();
    },
    resetMatch() {
      state.round = 1;
      state.score.attackers = 0;
      state.score.defenders = 0;
      state.money = ROUND.START_MONEY;
      state.matchOver = false;
      state.winner = null;
      state.endReason = '';
      this.startBuy();
    },
  };
}
