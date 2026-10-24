export function setupModelPicker({dialog, search, list, status, retry, loadModels, currentModel, selectModel}) {
  let models = [];
  let request = 0;

  function render() {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const matches = models.filter(model => `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(query));
    for (const model of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-option';
      button.setAttribute('aria-pressed', String(model.id === currentModel().id));
      const text = document.createElement('span');
      const name = document.createElement('strong'); name.textContent = model.name;
      const id = document.createElement('small'); id.textContent = model.id;
      const price = document.createElement('small'); price.textContent = model.pricing.description;
      text.append(name, id, price);
      const badge = document.createElement('span');
      badge.className = 'price-band'; badge.textContent = model.pricing.band;
      badge.title = model.pricing.description;
      button.append(text, badge);
      button.addEventListener('click', () => {selectModel(model); dialog.close();});
      list.append(button);
    }
    if (models.length) status.textContent = matches.length ? `${matches.length} models` : 'No matching models.';
  }

  async function load() {
    const attempt = ++request;
    models = []; render();
    status.textContent = 'Loading models from Puter…'; retry.hidden = true;
    try {
      const result = await loadModels();
      if (attempt !== request || !dialog.open) return;
      models = result; render();
    } catch (error) {
      if (attempt !== request || !dialog.open) return;
      status.textContent = error.message || 'Could not load models. Try again.';
      retry.hidden = false;
    }
  }
  search.addEventListener('input', render);
  retry.addEventListener('click', load);
  return {
    open(query = '') {
      search.value = query;
      if (!dialog.open) dialog.showModal();
      search.focus();
      return load();
    }
  };
}
