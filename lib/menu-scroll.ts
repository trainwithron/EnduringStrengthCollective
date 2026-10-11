// A popup menu that closes when the page scrolls under it must NOT close when the menu's own list scrolls (a long client list inside the menu). The scroll listener is registered with
// capture, so it also hears scrolls from inside the menu; this tells the two apart.
export function scrollIsInsideMenu(menu: { contains(node: never): boolean } | null | undefined, target: EventTarget | null): boolean {
  if (!menu || !target) return false;
  try {
    // The page itself scrolling reports the document or window as the target; a menu's contains() answers false for the document and throws for the window, both "not inside".
    return menu.contains(target as never);
  } catch {
    return false;
  }
}
