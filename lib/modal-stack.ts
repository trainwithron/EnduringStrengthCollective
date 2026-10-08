// Two dialogs can be open at once (the client preview with a demo opened over it). A dialog that says aria-modal is the top one only when it is the last in the page, so:
//  - Escape belongs to the top dialog alone: a lower one stays open while another aria-modal dialog is present (the top one closes itself);
//  - the page may scroll again only once NO dialog is left, whatever order the dialogs close in (each used to restore the value it had saved, so the wrong one could win and leave the page stuck).

const MODAL = '[aria-modal="true"]';

// True when more than the calling dialog is open (the calling dialog is itself one of them).
export function anotherModalIsOpen(doc: Pick<Document, "querySelectorAll"> = document): boolean {
  return doc.querySelectorAll(MODAL).length > 1;
}

// Run from a dialog's cleanup. Checks after the unmount has finished, then sets the page's scrolling from what is really left on screen.
export function releaseScrollLock(doc: Pick<Document, "querySelector" | "body"> = document): void {
  queueMicrotask(() => {
    doc.body.style.overflow = doc.querySelector(MODAL) ? "hidden" : "";
  });
}
