export function setVisible(element, visible) {
  element.classList.toggle("hidden", !visible);
}

export function setMessage(element, text, kind = "info") {
  element.textContent = text;
  element.classList.remove("hidden");
  element.dataset.kind = kind;
}

export function clearChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
