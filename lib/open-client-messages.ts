// The client profile's header Message button (clutter pass, Nov 21): the tabs switch on the page itself (no address change), so a link to ?tab=messages did nothing from another
// tab. The button sends this event instead: the tab strip goes to Overview and the message box there opens. A fresh load of ?tab=messages still opens the box.
export const OPEN_CLIENT_MESSAGES_EVENT = "spotlight:open-client-messages";

export function openClientMessages(target: Pick<EventTarget, "dispatchEvent"> = window): void {
  target.dispatchEvent(new Event(OPEN_CLIENT_MESSAGES_EVENT));
}
