// A short, memorable code — not a credential. Just enough friction that
// one athlete can't casually check in on another's name by tapping it
// for them; a coach can always view/reset it directly (mobile_more_tab_
// condensed_widget_hub_sept30.md's Kiosk Check-In follow-up).
export function generateKioskPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}
