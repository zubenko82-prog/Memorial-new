// apps/bot/src/modules/filterMenu.js
import { Markup } from 'telegraf';

const normStr = (v) => String(v || '').trim();
const formatRub = (n) => {
  const s = Math.round(Number(n) || 0).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

// Утилита: ссылки на посты
function makeChannelPostLink(CHANNEL_USERNAME, channelChatId, messageId) {
  if (CHANNEL_USERNAME) return `https://t.me/${String(CHANNEL_USERNAME).replace('@', '')}/${messageId}`;
  const n = Number(channelChatId);
  if (Number.isFinite(n)) return `https://t.me/c/${Math.abs(n)}/${messageId}`;
  return '';
}

// ====== Определение доступных фильтров ======
// Теги берутся из вашего же calcCaptionAndTags().caption (там "#..." через пробел).
// Тут описываем UI-ярлыки и соответствие тегу.
const TAG_FILTERS = [
  { key: 'no_plita', label: 'Без плиты', tag: '#без_плиты' },
  { key: 'no_cvetnik', label: 'Без цветника', tag: '#без_цветника' },
  // добавляйте любые ваши хэштеги из постов:
  // { key:'vertical', label:'Вертикальные', tag:'#вертикальный' },
  // { key:'gabbro', label:'Габбро', tag:'#габбро' },
];

const PRICE_FILTERS = [
  { key: 'p1', label: 'до 50 000', min: 0, max: 50000 },
  { key: 'p2', label: '50–80 000', min: 50000, max: 80000 },
  { key: 'p3', label: '80–120 000', min: 80000, max: 120000 },
  { key: 'p4', label: '120 000+', min: 120000, max: Number.POSITIVE_INFINITY },
];

function getFilterState(ctx) {
  ctx.session.filterMenu = ctx.session.filterMenu || {
    tags: {}, // { key: true }
    prices: {}, // { key: true }
  };
  return ctx.session.filterMenu;
}

function renderMenuText(state) {
  const chosenTags = TAG_FILTERS.filter((t) => state.tags[t.key]).map((t) => t.label);
  const chosenPrices = PRICE_FILTERS.filter((p) => state.prices[p.key]).map((p) => p.label);

  return [
    'Фильтр каталога:',
    '',
    `Теги: ${chosenTags.length ? chosenTags.join(', ') : '— любые —'}`,
    `Цена: ${chosenPrices.length ? chosenPrices.join(', ') : '— любая —'}`,
    '',
    'Выберите параметры и нажмите «Показать»',
  ].join('\n');
}

function menuKb(state) {
  const tagButtons = TAG_FILTERS.map((t) => {
    const checked = state.tags[t.key] ? '✅ ' : '';
    return Markup.button.callback(`${checked}${t.label}`, `flt:tag:${t.key}`);
  });

  const priceButtons = PRICE_FILTERS.map((p) => {
    const checked = state.prices[p.key] ? '✅ ' : '';
    return Markup.button.callback(`${checked}${p.label}`, `flt:price:${p.key}`);
  });

  const rows = [];

  // теги по 2 в ряд
  for (let i = 0; i < tagButtons.length; i += 2) rows.push(tagButtons.slice(i, i + 2));
  // цены по 2 в ряд
  for (let i = 0; i < priceButtons.length; i += 2) rows.push(priceButtons.slice(i, i + 2));

  rows.push([
    Markup.button.callback('🔎 Показать', 'flt:show'),
    Markup.button.callback('♻️ Сбросить', 'flt:reset'),
  ]);

  return Markup.inlineKeyboard(rows);
}

// Вытащить теги из caption
function extractTagsFromCaption(caption) {
  const tags = new Set();
  const parts = String(caption || '').split(/\s+/);
  for (const p of parts) {
    if (p.startsWith('#')) tags.add(p.trim());
  }
  return tags;
}

// Применение фильтра к одному посту (meta)
function matchPost(meta, selectedTagKeys, selectedPriceKeys, tagIndex, priceIndex) {
  if (!meta) return false;

  // tags
  if (selectedTagKeys.length) {
    // AND-логика: должны присутствовать ВСЕ выбранные теги
    for (const key of selectedTagKeys) {
      const needTag = tagIndex.get(key);
      if (!needTag) continue;
      const tags = meta._tagsSet || new Set();
      if (!tags.has(needTag)) return false;
    }
  }

  // price
  if (selectedPriceKeys.length) {
    const price = Number(meta.last_total_price ?? meta.lastTotalPrice ?? meta.total ?? 0);
    let ok = false;
    for (const k of selectedPriceKeys) {
      const band = priceIndex.get(k);
      if (!band) continue;
      if (price >= band.min && price < band.max) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  return true;
}

export function registerFilterMenu(bot, deps) {
  const {
    CHANNEL_USERNAME,
    getAllCatalogPostKeys,
    getCatalogPostMetaByKey,
    loadCatalogFromXlsx,
    CATALOG_XLSX_PATH,
    calcCaptionAndTags, // передадим из postWizard, чтобы не дублировать
  } = deps;

  // показать меню фильтра
  async function showFilterMenu(ctx) {
    const state = getFilterState(ctx);
    const text = renderMenuText(state);
    const kb = menuKb(state);

    // если это вызов из callback — удобнее edit
    if (ctx.updateType === 'callback_query') {
      try {
        await ctx.editMessageText(text, kb);
      } catch {
        await ctx.reply(text, kb);
      }
      return;
    }

    await ctx.reply(text, kb);
  }

  // получить каталог постов (meta) и проставить _tagsSet
  async function loadPostsWithTags() {
    const keys = await getAllCatalogPostKeys();
    if (!Array.isArray(keys) || keys.length === 0) return [];

    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);

    const posts = [];
    for (const key of keys) {
      const messageIdStr = String(key).replace(/^catalogpost:/, '');
      const messageId = Number(messageIdStr);
      if (!Number.isFinite(messageId)) continue;

      const meta = await getCatalogPostMetaByKey(key);
      if (!meta?.selected || !meta.channelChatId) continue;

      const { caption } = calcCaptionAndTags(catalog, meta.selected);
      const tags = extractTagsFromCaption(caption);

      posts.push({
        key,
        messageId,
        channelChatId: meta.channelChatId,
        last_total_price: meta.last_total_price ?? 0,
        baseTextNoHint: meta.baseTextNoHint || '',
        _caption: caption,
        _tagsSet: tags,
      });
    }

    return posts;
  }

  // /start без параметров -> показываем фильтр
  bot.start(async (ctx) => {
    const text = ctx.message?.text || '';
    // если deep-link: /start order_xxx — пусть отрабатывает orders.js (он обычно перехватывает сам)
    // но чтобы не конфликтовать — показываем фильтр только если нет параметров
    const hasParam = /\s+/.test(text);
    if (hasParam) return;
    return showFilterMenu(ctx);
  });

  // команда /filter (на всякий)
  bot.command('filter', async (ctx) => showFilterMenu(ctx));

  // callbacks
  bot.action(/^flt:(tag|price):(.+)$/, async (ctx) => {
    const [, kind, key] = ctx.match;
    const state = getFilterState(ctx);

    if (kind === 'tag') state.tags[key] = !state.tags[key];
    if (kind === 'price') state.prices[key] = !state.prices[key];

    await ctx.answerCbQuery();
    return showFilterMenu(ctx);
  });

  bot.action('flt:reset', async (ctx) => {
    ctx.session.filterMenu = { tags: {}, prices: {} };
    await ctx.answerCbQuery();
    return showFilterMenu(ctx);
  });

  bot.action('flt:show', async (ctx) => {
    await ctx.answerCbQuery('Ищу...');

    const state = getFilterState(ctx);
    const selectedTagKeys = Object.entries(state.tags)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const selectedPriceKeys = Object.entries(state.prices)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const tagIndex = new Map(TAG_FILTERS.map((t) => [t.key, t.tag]));
    const priceIndex = new Map(PRICE_FILTERS.map((p) => [p.key, { min: p.min, max: p.max }]));

    const posts = await loadPostsWithTags();
    const matched = posts.filter((p) => matchPost(p, selectedTagKeys, selectedPriceKeys, tagIndex, priceIndex));

    if (!matched.length) {
      await ctx.reply('Ничего не найдено по выбранным параметрам. Попробуйте убрать часть фильтров.');
      return showFilterMenu(ctx);
    }

    // сортировка по цене
    matched.sort((a, b) => Number(a.last_total_price || 0) - Number(b.last_total_price || 0));

    const top = matched.slice(0, 20);
    const lines = top.map((p, idx) => {
      const link = makeChannelPostLink(CHANNEL_USERNAME, p.channelChatId, p.messageId);
      return `${idx + 1}) Цена: от ${formatRub(p.last_total_price)} ₽\n${link}`;
    });

    await ctx.reply(`Нашёл: ${matched.length}\nПоказываю первые ${top.length}:\n\n${lines.join('\n\n')}`);

    return showFilterMenu(ctx);
  });

  // Экспортируем функцию, чтобы можно было вызвать из orders.js "в конце заказа"
  return { showFilterMenu };
}