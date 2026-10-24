export function setupPanelDivider({panels, divider, editor, stored, save}) {
  const saved = Number(stored('logo.panel-ratio.v1', '0.49'));
  let ratio = Number.isFinite(saved) ? saved : 0.49;
  let pointer = null;

  function bounds() {
    const available = Math.max(400, panels.getBoundingClientRect().height - 18);
    return {available, min: Math.max(0.15, 140 / available), max: Math.min(0.8, 1 - 220 / available)};
  }

  function apply(value, persist = false) {
    const {min, max} = bounds();
    ratio = Math.max(min, Math.min(max, value));
    panels.style.setProperty('--code-size', `${ratio}fr`);
    panels.style.setProperty('--chat-size', `${1 - ratio}fr`);
    divider.setAttribute('aria-valuemin', Math.round(min * 100));
    divider.setAttribute('aria-valuemax', Math.round(max * 100));
    divider.setAttribute('aria-valuenow', Math.round(ratio * 100));
    divider.setAttribute('aria-valuetext', `${Math.round(ratio * 100)}% code`);
    if (persist) save('logo.panel-ratio.v1', String(ratio));
    editor.refresh();
  }

  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointer = event.pointerId;
    divider.setPointerCapture(pointer);
  });
  divider.addEventListener('pointermove', event => {
    if (pointer !== event.pointerId) return;
    const {available} = bounds();
    apply((event.clientY - panels.getBoundingClientRect().top) / available, true);
  });
  function stop() { pointer = null; }
  divider.addEventListener('pointerup', stop);
  divider.addEventListener('pointercancel', stop);
  divider.addEventListener('lostpointercapture', stop);
  divider.addEventListener('keydown', event => {
    const {min, max} = bounds();
    const changes = {ArrowUp: ratio - 0.05, ArrowDown: ratio + 0.05, Home: min, End: max};
    if (!(event.key in changes)) return;
    event.preventDefault();
    apply(changes[event.key], true);
  });
  new ResizeObserver(() => apply(ratio)).observe(panels);
  apply(ratio);
}
