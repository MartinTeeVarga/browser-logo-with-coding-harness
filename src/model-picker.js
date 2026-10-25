import { isLatestModel } from './models.js';

export function setupModelPicker({dialog, search, list, status, retry, loadModels, currentModel, selectModel, latestTab, allTab}) {
  let models = [];
  let request = 0;
  let tab = 'latest';

  function render() {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const available = tab === 'latest' ? models.filter(isLatestModel) : models;
    const matches = available.filter(model => `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(query));
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
  function selectTab(value) {
    tab = value;
    latestTab.setAttribute('aria-selected', String(tab === 'latest'));
    allTab.setAttribute('aria-selected', String(tab === 'all'));
    latestTab.tabIndex = tab === 'latest' ? 0 : -1;
    allTab.tabIndex = tab === 'all' ? 0 : -1;
    list.setAttribute('aria-labelledby', tab === 'latest' ? latestTab.id : allTab.id);
    render();
  }
  latestTab.addEventListener('click', () => selectTab('latest'));
  allTab.addEventListener('click', () => selectTab('all'));
  function tabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'latest' : event.key === 'End' ? 'all' : tab === 'latest' ? 'all' : 'latest';
    selectTab(next);
    (next === 'latest' ? latestTab : allTab).focus();
  }
  latestTab.addEventListener('keydown', tabKey);
  allTab.addEventListener('keydown', tabKey);
  search.addEventListener('input', render);
  retry.addEventListener('click', load);
  return {
    open(query = '') {
      search.value = query;
      selectTab('latest');
      if (!dialog.open) dialog.showModal();
      search.focus();
      return load();
    }
  };
}
