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
// ROUND — the match's numbers in one place. BUY 15 s (shop and move),
// LIVE 100 s (fight), BOMB 35 s (the defuse window), PLANT 3 s and
// DEFUSE 5 s (a defuse takes longer than a plant — the defenders'
// disadvantage is the clock, not the fight), WIN_ROUNDS 5 (first to five,
// no overtime), WIN_MONEY 3250 and LOSS_MONEY 1900 (winning buys the next
// round's gun, losing still buys something), KILL_MONEY 300 and
// PLANT_MONEY 300 (the same $300 for a kill and a plant — both are
// round-winning acts), START_MONEY 800 (a pistol round by design: the
// first round is a pistol round, the second is the first buy round).
// Change one number and the whole match economy moves with it.
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
    // startBuy — open the buy phase: 15 s on the timer, bomb state cleared,
// channels cleared. Called at match start and at every round start, so
// a round never inherits a planted bomb or a half-finished channel.
startBuy() {
      state.phase = 'buy';
      state.timer = ROUND.BUY_SECONDS;
      state.planted = false;
      state.plantedSite = null;
      state.plantProgress = 0;
      state.defuseProgress = 0;
      state.defusing = null;
    },
    // startLive — the round goes live: 100 s on the timer. Called when the buy
// timer hits zero, not by a button — the round starts when the buy phase
// ends, whether the player finished shopping or not.
startLive() {
      state.phase = 'live';
      state.timer = ROUND.LIVE_SECONDS;
    },
    // plant — the bomb is down: planted at the named site, 35 s on the bomb
// timer, the plant channel cleared, and the $300 plant bonus paid. The
// site name is stored, not the position, because the bomb mesh and the
// defender rotation both key off the site.
plant(site) {
      state.planted = true;
      state.plantedSite = site;
      state.bombTimer = ROUND.BOMB_SECONDS;
      state.plantProgress = 0;
      state.money += ROUND.PLANT_MONEY;
    },
    // detonate / defused — the two planted-bomb endings. Detonation clears
// the planted flag and ends the round for the attackers ("Bomb
// detonated"); a defuse clears the planted flag and the defuse progress
// and ends it for the defenders ("Bomb defused"). Both go through
// endRound, so the payout, the banner and the match-over check happen in
// exactly one place.
detonate() {
      state.planted = false;
      this.endRound('attackers', 'Bomb detonated');
    },
    // defused — the bomb is disarmed: planted cleared, defuse progress
// cleared, round to the defenders. The bomb mesh is hidden by main.js;
// this module only owns the state, so the two cannot disagree about
// whether a bomb is planted.
defused() {
      state.planted = false;
      state.defuseProgress = 0;
      this.endRound('defenders', 'Bomb defused');
    },
    // endRound — decide a round, once: the phase becomes end (a second call
// is ignored, so a detonation and an elimination in the same step cannot
// pay out twice), the reason is recorded for the banner, the end timer
// runs 4 s, the score increments, the payout lands (win $3250, loss
// $1900), and at 5 rounds the match is over. Money is paid here and
// nowhere else, so the economy has exactly one source of truth.
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
    // addKillMoney / nextRound — the two small transactions: +$300 for a kill
// (paid immediately, so the HUD money jumps on the kill feed's line) and
// the round counter advancing into a fresh buy phase. nextRound does not
// reset positions or the HUD — main.js owns that, in step()'s end-phase
// branch, so the round transition has one caller.
addKillMoney() {
      state.money += ROUND.KILL_MONEY;
    },
    // nextRound — advance the counter and open the next buy phase. The score
// and money carry over (a match is an economy across rounds, not a fresh
// start each round), and the match-over flag is untouched: a match that
// is over stays over, and nextRound is never called for it.
nextRound() {
      state.round += 1;
      this.startBuy();
    },
    // resetMatch — the whole match back to the start: round 1, 0–0, $800,
// nothing over, no winner, no reason, buy phase open. Called by
// startMatch, which then resets positions and the HUD on top.
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
