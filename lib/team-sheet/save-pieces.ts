/** How many workouts one database call carries when a team sheet is saved. A call of 50 takes under a second; a long single call can run into the database's time limit, so a big upload is sent in pieces that join into one upload. */
export function savePiece(): number {
  return 50;
}
