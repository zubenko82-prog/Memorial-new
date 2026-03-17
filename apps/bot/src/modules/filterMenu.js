// apps/bot/src/modules/filterMenu.js
import { Markup } from 'telegraf';

// ====== ФИЛЬТРЫ (чекбоксы, мультивыбор) ======
const TAG_FILTERS = [
  // Стела (размеры)
  { key: 'stela_60x40x5', label: 'Стела 60×40×5', tag: '#стела_60x40x5' },
  { key: 'stela_60x40x8', label: 'Стела 60×40×8', tag: '#стела_60x40x8' },
  { key: 'stela_80x40x8', label: 'Стела 80×40×8', tag: '#стела_80x40x8' },
  { key: 'stela_100x50x8', label: 'Стела 100×50×8', tag: '#стела_100x50x8' },
  { key: 'stela_120x60x8', label: 'Стела 120×60×8', tag: '#стела_120x60x8' },
  { key: 'stela_140x70x8', label: 'Стела 140×70×8', tag: '#стела_140x70x8' },

  // Надгробная плита
  { key: 'no_plita', label: 'Без плиты', tag: '#без_плиты' },
  { key: 'plita_80x40x5', label: 'Плита 80×40×5', tag: '#плита_80x40x5' },
  { key: 'plita_100x50x5', label: 'Плита 100×50×5', tag: '#плита_100x50x5' },
  { key: 'plita_120x60x5', label: 'Плита 120×60×5', tag: '#плита_120x60x5' },

  // Тип работы
  { key: 'work_mill', label: 'Фрезерная работа', tag: '#фрезерная_работа' },
  { key: 'work_carve', label: 'Резная работа', tag: '#резная_работа' },

  // было ранее
  { key: 'no_cvetnik', label: 'Без цветника', tag: '#без_цветника' },
];

const PRICE_FILTERS = [
  { key: 'p1', label: 'до 50 000', min: 0, max: 50000 },
  { key: 'p2', label: '50–80 000', min: 50000, max: 80000 },
  { key: 'p3', label: '80–120 000', min: 80000, max: 120000 },
  { key: 'p4', label: '120 000+', min: 120000, max: Number.POSITIVE_INFINITY },
];

function getFilterState(ctx) {
  ctx.session.filterMenu = ctx.session.filterMenu || { tags: {}, prices: {} };
  return ctx.session.filterMenu;
}

function renderMenuText(state) {
  const chosenTags = TAG_FILTERS.filter((t) => state.tags[t.key]).map((t) => t.label);
  const chosenPrices = PRICE_FILTERS.filter((p) => state.prices[p.key]).map((p) => p.label);

  return [
    'Фильтр каталога:',
    '',
    `Параметры: ${chosenTags.length ? chosenTags.join(', ') : '— любые —'}`,
    `Бюджет: ${chosenPrices.length ? chosenPrices.join(', ') : '— любой —'}`,
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
  for (let i = 0; i < tagButtons.length; i += 2) rows.push(tagButtons.slice(i, i + 2));
  for (let i = 0; i < priceButtons.length; i += 2) rows.push(priceButtons.slice(i, i + 2));

  rows.push([
    Markup.button.callback('🔎 Показать', 'flt:show'),
    Markup.button.callback('♻️ Сбросить', 'flt:reset'),
  ]);

  return Markup.inlineKeyboard(rows);
}

function extractTagsFromCaption(caption) {
  const tags = new Set();
  const parts = String(caption || '').split(/\s+/);
  for (const p of parts) if (p.startsWith('#')) tags.add(p.trim());
  return tags;
}

// ✅ OR по тегам, OR по бюджету
// - если не выбрано ни одного тега => теги не ограничивают
// - если не выбран бюджет => бюджет не ограничивает
function matchPost(meta, selectedTagKeys, selectedPriceKeys, tagIndex, priceIndex) {
  if (!meta) return false;

  // OR tags
  if (selectedTagKeys.length) {
    const tags = meta._tagsSet || new Set();
    let ok = false;
    for (const key of selectedTagKeys) {
      const needTag = tagIndex.get(key);
      if (!needTag) continue;
      if (tags.has(needTag)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  // OR price
  if (selectedPriceKeys.length) {
    const price = Number(meta.last_total_price ?? 0);
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

function buildInlineKbForPost(botUsername, WEBAPP_URL, DEEPLINK_PREFIX, sourceToken) {
  const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
  const webAppUrl = WEBAPP_URL ? new URL(WEBAPP_URL).toString() : null;

  if (webAppUrl) {
    return Markup.inlineKeyboard([
      [
        Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`),
        Markup.button.webApp('Подобрать памятник', webAppUrl),
      ],
    ]);
  }

  return Markup.inlineKeyboard([[Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`)]]);
}

export function registerFilterMenu(bot, deps) {
  const {
    CHANNEL_USERNAME,
    WEBAPP_URL,
    DEEPLINK_PREFIX,
    getAllCatalogPostKeys,
    getCatalogPostMetaByKey,
    loadCatalogFromXlsx,
    CATALOG_XLSX_PATH,
    calcCaptionAndTags,
  } = deps;

  // чтобы "прятать меню" до конца выдачи:
  // сохраняем id сообщения меню (у пользователя в этой сессии)
  function getMenuMsgId(ctx) {
    return ctx.session?.filterMenuMsgId || null;
  }
  function setMenuMsgId(ctx, messageId) {
    ctx.session.filterMenuMsgId = messageId;
  }

  async function hideMenuMessageIfAny(ctx) {
    const mid = getMenuMsgId(ctx);
    if (!mid) return;
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, mid);
    } catch {
      // ignore
    }
    ctx.session.filterMenuMsgId = null;
  }

  async function showFilterMenu(ctx) {
    const state = getFilterState(ctx);
    const text = renderMenuText(state);
    const kb = menuKb(state);

    // если меню вызывается кнопкой "Фильтр каталога" после выдачи — это обычный message/hears
    // если меню вызывается из callback (когда меню уже открыто) — edit
    if (ctx.updateType === 'callback_query') {
      try {
        await ctx.editMessageText(text, kb);
        // message_id меню уже есть (текущий)
        const mid = ctx.callbackQuery?.message?.message_id;
        if (mid) setMenuMsgId(ctx, mid);
      } catch {
        const m = await ctx.reply(text, kb);
        if (m?.message_id) setMenuMsgId(ctx, m.message_id);
      }
      return;
    }

    const m = await ctx.reply(text, kb);
    if (m?.message_id) setMenuMsgId(ctx, m.message_id);
  }

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

      // Важно: используем только "настоящий" sourceToken, чтобы менеджеру приходила ссылка/состав
      if (!meta.sourceToken) continue;

      posts.push({
        key,
        messageId,
        channelChatId: meta.channelChatId,
        last_total_price: Number(meta.last_total_price ?? 0),
        sourceToken: meta.sourceToken,
        _tagsSet: tags,
      });
    }

    return posts;
  }

  // Команда оставляем (можно открыть меню вручную)
  bot.command('filter', async (ctx) => showFilterMenu(ctx));

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

    // ✅ прячем меню перед выдачей
    await hideMenuMessageIfAny(ctx);

    const state = getFilterState(ctx);
    const selectedTagKeys = Object.entries(state.tags).filter(([, v]) => v).map(([k]) => k);
    const selectedPriceKeys = Object.entries(state.prices).filter(([, v]) => v).map(([k]) => k);

    const tagIndex = new Map(TAG_FILTERS.map((t) => [t.key, t.tag]));
    const priceIndex = new Map(PRICE_FILTERS.map((p) => [p.key, { min: p.min, max: p.max }]));

    const posts = await loadPostsWithTags();
    const matched = posts.filter((p) => matchPost(p, selectedTagKeys, selectedPriceKeys, tagIndex, priceIndex));

    if (!matched.length) {
      const m = await ctx.reply('Ничего не найдено по выбранным параметрам.');
      // после "ничего" — снова показать меню
      await showFilterMenu(ctx);
      return m;
    }

    matched.sort((a, b) => (a.last_total_price || 0) - (b.last_total_price || 0));

    const MAX_SEND = 30;
    const toSend = matched.slice(0, MAX_SEND);

    const me = ctx.botInfo || (await ctx.telegram.getMe());
    const botUsername = me.username;

    // 1) сначала все найденные посты (с кнопками)
    for (const p of toSend) {
      const sent = await ctx.telegram.copyMessage(ctx.chat.id, p.channelChatId, p.messageId).catch(async () => {
        const link = CHANNEL_USERNAME
          ? `https://t.me/${String(CHANNEL_USERNAME).replace('@', '')}/${p.messageId}`
          : `https://t.me/c/${Math.abs(Number(p.channelChatId))}/${p.messageId}`;
        await ctx.reply(link);
        return null;
      });

      if (!sent?.message_id) continue;

      const kb = buildInlineKbForPost(botUsername, WEBAPP_URL, DEEPLINK_PREFIX, p.sourceToken);

      try {
        await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, sent.message_id, undefined, kb.reply_markup);
      } catch {
        // ignore
      }
    }

    // 2) последним сообщением — сколько найдено/показано + кнопка "Фильтр каталога"
    await ctx.reply(
      `Найдено: ${matched.length}\nПоказано: ${toSend.length}` + (matched.length > MAX_SEND ? `\n(показываю первые ${MAX_SEND})` : ''),
      Markup.inlineKeyboard([[Markup.button.callback('📚 Фильтр каталога', 'flt:open')]])
    );
  });

  // кнопка "Фильтр каталога" под итоговым сообщением
  bot.action('flt:open', async (ctx) => {
    await ctx.answerCbQuery();
    return showFilterMenu(ctx);
  });

  return { showFilterMenu };
}