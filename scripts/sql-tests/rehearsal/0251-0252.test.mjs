// 0251: kiosk PINs live hashed where no client can read them; five wrong tries lock that athlete's PIN (15 min, then 1 hour, then a day) and a
// right PIN clears the count; only the group's coach can set or check them. 0252 (after the new code is deployed) drops the plain column.
export default {
  name: "0251/0252 kiosk PINs: hashed, lockout and escalation",
  migrations: ["0251", "0252"],
  phases: {
    // Just before 0251: PINs are plain text and readable by every member of the group.
    async "0250"({ db, h, state }) {
      const coach = await h.user("Kiosk Coach");
      const org = await h.org(coach);
      const group = await h.group(org, coach, "team", "Gym");
      const ann = await h.user("Kiosk Ann");
      const bo = await h.user("Kiosk Bo");
      const cy = await h.user("Kiosk Cy");
      for (const a of [ann, bo, cy]) await h.member(group, a);
      await h.asSuper();
      await db.query(`update public.group_memberships set kiosk_pin = '1234' where group_id = $1 and profile_id = $2`, [group, ann]);
      Object.assign(state, { coach, group, ann, bo, cy });
      await h.as(bo);
      const seen = await h.rows(`select kiosk_pin from public.group_memberships where group_id = $1 and profile_id = $2`, [group, ann]);
      h.check("baseline: before 0251 any member of the group can read another athlete's plain-text kiosk PIN (the exposure 0251 removes)", seen[0]?.kiosk_pin === "1234");
    },

    async "0251"({ db, h, state }) {
      const { coach, group, ann, bo, cy } = state;
      const verify = async (uid, athlete, pin) => { await h.as(uid); return (await h.one(`select public.verify_kiosk_pin($1, $2, $3) as r`, [group, athlete, pin])).r; };

      h.check("an existing plain PIN was copied across hashed and still checks out", (await verify(coach, ann, "1234")) === "ok");
      await h.asSuper();
      const hash = (await h.one(`select pin_hash from public.kiosk_pins where group_id = $1 and athlete_id = $2`, [group, ann])).pin_hash;
      h.check("what is stored is a bcrypt hash, not the PIN", hash.startsWith("$2") && !hash.includes("1234"));

      // nobody on the client side can read the table
      await h.as(bo);
      h.check("an athlete cannot read kiosk_pins", (await h.rows(`select * from public.kiosk_pins`)).length === 0);
      await h.as(coach);
      h.check("not even the coach can read kiosk_pins directly", (await h.rows(`select * from public.kiosk_pins`)).length === 0);
      await h.expectErrorAs(bo, "an athlete cannot write a PIN row directly", `insert into public.kiosk_pins (group_id, athlete_id, pin_hash) values ($1, $2, 'x')`, [group, bo], /row-level security/i);

      // set / status
      await h.as(coach);
      await db.query(`select public.set_kiosk_pin($1, $2, '4321')`, [group, bo]);
      h.check("the coach can set a PIN for an athlete in the group", (await verify(coach, bo, "4321")) === "ok");
      await h.as(coach);
      const status = await h.rows(`select * from public.kiosk_pin_status($1)`, [group]);
      h.check("kiosk_pin_status lists who has a PIN and returns no PIN or hash", status.length === 2 && status.every((r) => Object.keys(r).sort().join() === "athlete_id,has_pin"));
      await h.expectError("a PIN must be exactly 4 digits", () => db.query(`select public.set_kiosk_pin($1, $2, '12a4')`, [group, cy]), /4 digits/);
      await h.expectError("a PIN of the wrong length is refused", () => db.query(`select public.set_kiosk_pin($1, $2, '12345')`, [group, cy]), /4 digits/);
      await h.expectError("a PIN cannot be set for someone who is not an athlete in the group", () => db.query(`select public.set_kiosk_pin($1, $2, '1111')`, [group, coach]), /not an athlete/);
      await h.expectErrorAs(bo, "an athlete cannot set PINs", `select public.set_kiosk_pin($1, $2, '1111')`, [group, cy], /not authorized/);
      await h.expectErrorAs(bo, "an athlete cannot check anyone's PIN", `select public.verify_kiosk_pin($1, $2, '4321')`, [group, bo], /not authorized/);
      await h.expectErrorAs(bo, "an athlete cannot ask who has PINs", `select * from public.kiosk_pin_status($1)`, [group], /not authorized/);
      await h.as(null);
      await h.expectError("a signed-out caller cannot check a PIN", () => db.query(`select public.verify_kiosk_pin($1, $2, '4321')`, [group, bo]), /not authorized|permission denied/i);
      h.check("an athlete with no PIN reports no_pin", (await verify(coach, cy, "0000")) === "no_pin");

      // lockout: four wrong tries are wrong, the fifth locks
      const tries = [];
      for (let i = 0; i < 5; i++) tries.push(await verify(coach, bo, "0000"));
      h.check("four wrong tries answer 'wrong', the fifth locks the PIN", tries.join() === "wrong,wrong,wrong,wrong,locked", tries.join());
      h.check("while locked even the right PIN is refused", (await verify(coach, bo, "4321")) === "locked");
      await h.asSuper();
      const lock1 = await h.one(`select lock_count, failed_attempts, extract(epoch from (locked_until - now()))::int as secs from public.kiosk_pins where group_id = $1 and athlete_id = $2`, [group, bo]);
      h.check("the first lock lasts about 15 minutes", lock1.lock_count === 1 && lock1.secs > 14 * 60 && lock1.secs <= 15 * 60, JSON.stringify(lock1));
      h.check("a different athlete is not locked by someone else's wrong tries", (await verify(coach, ann, "1234")) === "ok");

      // second lock = 1 hour, third = 24 hours
      await h.asSuper();
      await db.query(`update public.kiosk_pins set locked_until = now() - interval '1 minute' where group_id = $1 and athlete_id = $2`, [group, bo]);
      for (let i = 0; i < 5; i++) await verify(coach, bo, "0000");
      await h.asSuper();
      const lock2 = await h.one(`select lock_count, extract(epoch from (locked_until - now()))::int as secs from public.kiosk_pins where group_id = $1 and athlete_id = $2`, [group, bo]);
      h.check("after the lock expires, five more wrong tries lock for 1 hour", lock2.lock_count === 2 && lock2.secs > 59 * 60 && lock2.secs <= 60 * 60, JSON.stringify(lock2));
      await db.query(`update public.kiosk_pins set locked_until = now() - interval '1 minute' where group_id = $1 and athlete_id = $2`, [group, bo]);
      for (let i = 0; i < 5; i++) await verify(coach, bo, "0000");
      await h.asSuper();
      const lock3 = await h.one(`select lock_count, extract(epoch from (locked_until - now()))::int as secs from public.kiosk_pins where group_id = $1 and athlete_id = $2`, [group, bo]);
      h.check("and the next time for 24 hours", lock3.lock_count === 3 && lock3.secs > 23 * 3600 && lock3.secs <= 24 * 3600, JSON.stringify(lock3));
      await db.query(`update public.kiosk_pins set locked_until = now() - interval '1 minute' where group_id = $1 and athlete_id = $2`, [group, bo]);
      await verify(coach, bo, "0000");
      h.check("a right PIN after a lock clears the count and the escalation", (await verify(coach, bo, "4321")) === "ok");
      await h.asSuper();
      const cleared = await h.one(`select failed_attempts, lock_count, locked_until from public.kiosk_pins where group_id = $1 and athlete_id = $2`, [group, bo]);
      h.check("(failed tries 0, lock count 0, no lock)", cleared.failed_attempts === 0 && cleared.lock_count === 0 && cleared.locked_until === null);
      h.check("a null PIN counts as wrong, not as a crash", (await verify(coach, bo, null)) === "wrong");
      await h.as(coach);
      await db.query(`select public.set_kiosk_pin($1, $2, '9999')`, [group, bo]);
      for (let i = 0; i < 5; i++) await verify(coach, bo, "0000");
      await db.query(`select public.set_kiosk_pin($1, $2, '1357')`, [group, bo]);
      h.check("resetting a locked athlete's PIN clears the lock", (await verify(coach, bo, "1357")) === "ok");
      state.after251 = true;
    },

    async "0252"({ db, h, state }) {
      const { coach, group, ann } = state;
      await h.asSuper();
      await h.expectError("0252: the plain-text kiosk_pin column is gone", () => db.query(`select kiosk_pin from public.group_memberships limit 1`), /does not exist/i);
      await h.as(coach);
      h.check("0252: PIN checking still works through the hashed table", (await h.one(`select public.verify_kiosk_pin($1, $2, '1234') as r`, [group, ann])).r === "ok");
      await db.query(`select public.set_kiosk_pin($1, $2, '2468')`, [group, ann]);
      h.check("0252: setting a PIN still works", (await h.one(`select public.verify_kiosk_pin($1, $2, '2468') as r`, [group, ann])).r === "ok");
    },
  },
};
