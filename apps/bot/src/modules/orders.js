// apps/bot/src/modules/orders.js
import { Markup } from 'telegraf';

// ---- утилиты для разбора состава заказа по catalog.xlsx ----
const normStr = (v) => String(v || '').trim();
const up = (v) => normStr(v).toUpperCase();

function normalizeSelectedToSkuList(selected) {
  const res = [];
  for (const v of Object.values(selected || {})) {
    if (!v) continue;
    if (Array.isArray(v)) res.push(...v);
    else res.push(v);
  }
  const seen = new Set();
  const out = [];
  for (const sku of res) {
    if (!seen.has(sku)) {
      seen.add(sku);
      out.push(sku);
    }
  }
  return out;
}

// собираем состав заказа и цену по данным поста
async function buildOrderCompositionText(sourceToken, makePostLink, getPostMeta, loadCatalogFromXlsx) {
  // по умолчанию: пустой состав, пустая цена, но ссылка может быть
  let compositionText = 'Состав заказа: —';
  let priceLine = 'Итого по посту: —';
  let postLink = '';

  if (!sourceToken || typeof getPostMeta !== 'function') {
    return { compositionText, priceLine, postLink };
  }

  const postMeta = await getPostMeta(sourceToken).catch(() => null);

  // ссылка на пост: используем то, что уже сохраняется в setPostMeta
  if (postMeta?.messageId) {
    const absChatId = postMeta.absChatId;
    postLink = makePostLink(absChatId, postMeta.messageId);
  }

  // если нет функции каталога или нет selected — просто возвращаем состав/цену "—", но со ссылкой
  if (!postMeta?.selected || typeof loadCatalogFromXlsx !== 'function') {
    return { compositionText, priceLine, postLink };
  }

  const selected = postMeta.selected;
  const lastTotal = Number(postMeta?.last_total_price || 0);

  let total = lastTotal;
  const compositionLines = [];

  try {
    const catalog = await loadCatalogFromXlsx();
    const items = catalog.items || [];

    const bySku = new Map(items.map((it) => [it.sku, it]));
    const skuList = normalizeSelectedToSkuList(selected);

    total = 0;
    const groupLines = {
      STELA: [],
      TUMBA: [],
      CVETNIK: [],
      PLITA: [],
      WORK: [],
      OPTION: [],
      GRAFIKA: [],
    };

    for (const sku of skuList) {
      const it = bySku.get(sku);
      if (!it) continue;
      total += Number(it.price || 0);

      const line = `${it.label || it.sku} — ${Number(it.price || 0).toLocaleString('ru-RU')} ₽`;
      const g = up(it.group);
      if (groupLines[g]) groupLines[g].push(line);
    }

    const pushGroupBlock = (title, arr) => {
      if (!arr || !arr.length) return;
      compositionLines.push(title);
      for (const l of arr) compositionLines.push(`• ${l}`);
      compositionLines.push('');
    };

    pushGroupBlock('Стела:', groupLines.STELA);
    pushGroupBlock('Тумба:', groupLines.TUMBA);
    pushGroupBlock('Цветник:', groupLines.CVETNIK);
    pushGroupBlock('Плита:', groupLines.PLITA);
    pushGroupBlock('Работа:', groupLines.WORK);
    pushGroupBlock('Опции:', groupLines.OPTION);
    pushGroupBlock('Графика:', groupLines.GRAFIKA);
  } catch (e) {
    console.error('[orders] buildOrderCompositionText error', e?.message || e);
  }

  if (compositionLines.length) {
    compositionLines.unshift('Состав заказа:');
    compositionText = compositionLines.join('\n').trim();
  }

  priceLine =
    total > 0 ? `Итого по посту: ${Number(total).toLocaleString('ru-RU')} ₽` : 'Итого по посту: —';

  return { compositionText, priceLine, postLink };
}

async function buildManagerSummary(
  s,
  orderNo,
  user,
  {
    sourceToken,
    makePostLink,
    getPostMeta,
    loadCatalogFromXlsx,
  }
) {
  const fio = s.fio?.trim() || '-';
  const dates = s.dates?.trim() || '-';

  const u = user || {};
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || '—';
  const username = u.username ? `@${u.username}` : '—';
  const lang = u.language_code || '—';
  const isPremium = u.is_premium ? 'да' : 'нет';

  const tgPhone = s.tg_phone ? s.tg_phone : null;

  const lines = [
    `Новая заявка №${orderNo}`,
    '',
    'Данные Telegram:',
    `ID: ${u.id ?? '—'}`,
    `Имя: ${fullName}`,
    `Username: ${username}`,
    `Язык: ${lang}`,
    `Premium: ${isPremium}`,
    ...(tgPhone ? [`Телефон профиля (контакт): ${tgPhone}`] : []),
    '',
    'Данные анкеты:',
    `Заказчик: ${s.name || '—'}`,
    `Телефон (в анкете): ${s.phone || '—'}`,
    `ФИО усопшего: ${fio}`,
    `Даты: ${dates}`,
    s.photos?.length ? `Фото: ${s.photos.length} шт.` : 'Фото: —',
  ];

  if (s.comment?.trim()) lines.push(`Комментарий/связь: ${s.comment.trim()}`);

  try {
    const { compositionText, priceLine, postLink } = await buildOrderCompositionText(
      sourceToken,
      makePostLink,
      getPostMeta,
      loadCatalogFromXlsx
    );

    lines.push('');
    lines.push(compositionText);
    lines.push(priceLine);
    if (postLink) {
      lines.push('');
      lines.push(`Ссылка на пост: ${postLink}`);
    }
  } catch (e) {
    console.error('[orders] buildManagerSummary composition error', e?.message || e);
  }

  return lines.join('\n');
}

export function registerOrders(bot, deps) {
  console.log('[orders] registerOrders called');

  const {
    HINT_TEXT,
    DEEPLINK_PREFIX,
    phoneOk,
    makeOrderNo,
    makePostLink,
    MANAGER_CHAT_ID,

    CHANNEL_USERNAME,
    WEBAPP_URL,
    getPostMeta,
    loadCatalogFromXlsx, // ПОЛУЧАЕМ ИЗ bot.js
  } = deps;

  const kbName = () => Markup.keyboard([['Отменить']]).resize();
  const kbPhone = () =>
    Markup.keyboard([[Markup.button.contactRequest('📱 Отправить мой контакт')], ['⬅️ Назад'], ['Отменить']]).resize();
  const kbBackCancel = () => Markup.keyboard([['⬅️ Назад'], ['Отменить']]).resize();
  const kbPhotos = () => Markup.keyboard([['Далее'], ['⬅️ Назад'], ['Отменить']]).resize();
  const kbComment = () => Markup.keyboard([['Продолжить'], ['⬅️ Назад'], ['Отменить']]).resize();
  const kbReview = () => Markup.keyboard([['Отправить'], ['⬅️ Назад'], ['Отменить']]).resize();
  const kbRemove = () => Markup.removeKeyboard();

  const stepOrder = ['name', 'phone', 'fio', 'dates', 'photos', 'comment', 'review'];

  function getOrder(ctx) {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.order) ctx.session.order = { step: 'name', photos: [] };
    return ctx.session.order;
  }

  async function renderStep(ctx) {
    const s = getOrder(ctx);
    const st = s.step;

    console.log('[orders] renderStep', st);

    if (st === 'name') {
      return ctx.reply('Шаг 1/6. Заказчик (ФИО/имя):', kbName());
    }
    if (st === 'phone') {
      return ctx.reply('Шаг 2/6. Номер телефона (или нажмите «📱 Отправить мой контакт»):', kbPhone());
    }
    if (st === 'fio') {
      return ctx.reply('Шаг 3/6. Фамилия/Имя/Отчество усопшего:', kbBackCancel());
    }
    if (st === 'dates') {
      return ctx.reply(
        'Шаг 4/6. Дата рождения — Дата смерти (в формате DD.MM.YYYY - DD.MM.YYYY). Например: 12.03.1950 - 05.11.2020',
        kbBackCancel()
      );
    }
    if (st === 'photos') {
      return ctx.reply('Шаг 5/6. Прикрепите фото. Когда закончите — нажмите «Далее».', kbPhotos());
    }
    if (st === 'comment') {
      return ctx.reply('Шаг 6/6. Комментарий или дополнительный способ связи (по желанию):', kbComment());
    }
    if (st === 'review') {
      return stepReview(ctx);
    }

    s.step = 'name';
    return ctx.reply('Шаг 1/6. Заказчик (ФИО/имя):', kbName());
  }

  async function stepBack(ctx) {
    const s = ctx.session?.order;
    if (!s?.step) return;

    const idx = stepOrder.indexOf(s.step);
    s.step = stepOrder[Math.max(0, idx - 1)];
    console.log('[orders] stepBack to', s.step);
    return renderStep(ctx);
  }

  async function startOrder(ctx, sourceToken) {
    console.log('[orders] startOrder, sourceToken =', sourceToken);
    ctx.session.order = {
      step: 'name',
      photos: [],
      ...(sourceToken ? { sourceToken } : {}),
    };
    return renderStep(ctx);
  }

  async function stepReview(ctx) {
    const s = getOrder(ctx);
    s.step = 'review';
    if (!s.orderNo) s.orderNo = makeOrderNo();

    const lines = [
      `Заявка №${s.orderNo}:`,
      '',
      `Заказчик: ${s.name || '—'}`,
      `Телефон: ${s.phone || '—'}`,
      `ФИО усопшего: ${s.fio?.trim() || '-'}`,
      `Даты: ${s.dates?.trim() || '-'}`,
      s.photos?.length ? `Фото: ${s.photos.length} шт.` : 'Фото: —',
      s.comment?.trim() ? `Комментарий/связь: ${s.comment.trim()}` : null,
    ].filter(Boolean);

    console.log('[orders] stepReview, orderNo =', s.orderNo);
    await ctx.reply(lines.join('\n'), kbReview());
  }

  async function sendOrderToManager(ctx, s, orderNo) {
    if (!MANAGER_CHAT_ID) throw new Error('MANAGER_CHAT_ID is not set');

    const managerText = await buildManagerSummary(s, orderNo, ctx.from, {
      sourceToken: s.sourceToken,
      makePostLink,
      getPostMeta,
      loadCatalogFromXlsx,
    });

    console.log(
      '[orders] sendOrderToManager, MANAGER_CHAT_ID =',
      MANAGER_CHAT_ID,
      'photos =',
      s.photos?.length || 0
    );

    const photos = Array.isArray(s.photos) ? s.photos : [];
    if (photos.length > 0) {
      const media = photos.slice(0, 10).map((fileId, i) => ({
        type: 'photo',
        media: fileId,
        ...(i === 0 ? { caption: managerText } : {}),
      }));
      await ctx.telegram.sendMediaGroup(MANAGER_CHAT_ID, media);

      if (photos.length > 10) {
        await ctx.telegram.sendMessage(
          MANAGER_CHAT_ID,
          `Дополнительные фото (${photos.length - 10} шт.) пользователь отправит отдельно.`
        );
      }
    } else {
      await ctx.telegram.sendMessage(MANAGER_CHAT_ID, managerText);
    }
  }

  async function submitOrder(ctx) {
    const s = getOrder(ctx);
    console.log('[orders] submitOrder called, step =', s.step);

    if (!s.name || !s.phone || !phoneOk(s.phone)) {
      console.log('[orders] submitOrder validation failed', { name: s.name, phone: s.phone });
      return ctx.reply(
        'Обязательные поля не заполнены: «Заказчик» и/или «Номер телефона». Вернитесь и исправьте.',
        kbName()
      );
    }

    const orderNo = s.orderNo || makeOrderNo();

    try {
      await sendOrderToManager(ctx, s, orderNo);

      const channelUrl = CHANNEL_USERNAME ? `https://t.me/${CHANNEL_USERNAME}` : null;
      const webAppUrl = WEBAPP_URL ? new URL(WEBAPP_URL).toString() : null;

      const row = [];
      if (channelUrl) row.push(Markup.button.url('Перейти в канал', channelUrl));
      if (webAppUrl) row.push(Markup.button.webApp('Подобрать памятник', webAppUrl));

      const replyMarkup =
        row.length > 0
          ? {
              reply_markup: {
                ...Markup.inlineKeyboard([row]).reply_markup,
                ...kbRemove().reply_markup,
              },
            }
          : kbRemove();

      console.log('[orders] submitOrder OK, orderNo =', orderNo);
      await ctx.reply(
        `Заявка №${orderNo} отправлена. Спасибо, ${s.name}! Наш менеджер свяжется с вами по указанному номеру. Вы можете перейти в канал t.me/${CHANNEL_USERNAME} или подобрать памятник`,
        replyMarkup
      );
    } catch (e) {
      const desc = e?.response?.description || e?.message || String(e);
      console.error('[orders] submitOrder error', desc);
      await ctx.reply('Не удалось отправить заявку. Попробуйте позже.', kbRemove());
    } finally {
      ctx.session.order = null;
    }
  }

  async function cancelOrder(ctx, msg = 'Отменено.') {
    console.log('[orders] cancelOrder');
    ctx.session.order = null;
    return ctx.reply(msg, kbRemove());
  }

  // -------- handlers --------

  bot.start(async (ctx) => {
    console.log('[orders] bot.start, text =', ctx.message?.text);

    const arg = (ctx.message?.text || '').split(' ').slice(1).join(' ').trim();

    let sourceToken = null;
    const prefix = `${DEEPLINK_PREFIX}_`;
    if (arg.startsWith(prefix)) {
      sourceToken = arg.slice(prefix.length);
    }

    await ctx.reply(HINT_TEXT);
    await startOrder(ctx, sourceToken || undefined);
  });

  bot.command('cancel', async (ctx) => cancelOrder(ctx, 'Анкета отменена.'));

  bot.hears('⬅️ Назад', async (ctx, next) => {
    if (!ctx.session?.order) return next();
    return stepBack(ctx);
  });

  bot.hears('Отменить', async (ctx, next) => {
    if (ctx.session?.order) return cancelOrder(ctx, 'Анкета отменена.');
    return next();
  });

  bot.hears('Далее', async (ctx, next) => {
    if (ctx.session?.order?.step === 'photos') {
      ctx.session.order.step = 'comment';
      return renderStep(ctx);
    }
    return next();
  });

  bot.hears('Продолжить', async (ctx, next) => {
    if (ctx.session?.order?.step === 'comment') return stepReview(ctx);
    return next();
  });

  bot.hears('Отправить', async (ctx, next) => {
    console.log('[orders] hears Отправить, step =', ctx.session?.order?.step);
    if (ctx.session?.order?.step === 'review') return submitOrder(ctx);
    return next();
  });

  bot.on('message', async (ctx, next) => {
    const st = ctx.session?.order?.step;
    if (!st) return next();

    console.log('[orders] on message, step =', st);

    const s = getOrder(ctx);

    if (st === 'phone' && 'contact' in ctx.message && ctx.message.contact?.phone_number) {
      const num = ctx.message.contact.phone_number;
      s.tg_phone = num;
      s.phone = num;
      s.step = 'fio';
      return renderStep(ctx);
    }

    if ('text' in ctx.message && ctx.message.text) {
      const text = ctx.message.text.trim();

      if (st === 'name') {
        s.name = text;
        s.step = 'phone';
        return renderStep(ctx);
      }
      if (st === 'phone') {
        if (!phoneOk(text)) {
          return ctx.reply(
            'Введите корректный номер телефона (минимум 6 цифр, можно с +) или нажмите «📱 Отправить мой контакт».',
            kbPhone()
          );
        }
        s.phone = text;
        s.step = 'fio';
        return renderStep(ctx);
      }
      if (st === 'fio') {
        s.fio = text;
        s.step = 'dates';
        return renderStep(ctx);
      }
      if (st === 'dates') {
        s.dates = text;
        s.step = 'photos';
        return renderStep(ctx);
      }
      if (st === 'comment') {
        if (text !== 'Продолжить' && text !== 'Отменить') {
          s.comment = text;
          return ctx.reply('Комментарий получен. Нажмите «Продолжить», чтобы перейти к сводке.', kbComment());
        }
      }
    }

    if ('photo' in ctx.message && ctx.message.photo?.length) {
      if (st === 'photos') {
        const fileId = ctx.message.photo.at(-1)?.file_id;
        if (fileId) {
          s.photos = s.photos || [];
          s.photos.push(fileId);
          return ctx.reply('Фото добавлено. Отправьте ещё или нажмите «Далее».', kbPhotos());
        }
      }
    }

    return next();
  });
}
